import { describe, it, expect } from "vitest";
import {
  codeFor,
  readStats,
  summarizeOffers,
  statRanks,
  offerDimensions,
} from "./offers.mjs";

describe("codeFor", () => {
  it("names armour by slot and tier digit, weapons by rarity", () => {
    expect(codeFor("boots", "legendary")).toBe("boots5");
    expect(codeFor("helmet", "common")).toBe("helmet1");
    expect(codeFor("jet", "mythic")).toBe("jet");
    expect(codeFor("knife", "common")).toBe("knife");
  });
  it("is null when the slot and rarity disagree or either is unknown", () => {
    expect(codeFor("jet", "common")).toBeNull();
    expect(codeFor("hat", "common")).toBeNull();
    expect(codeFor("boots", "shiny")).toBeNull();
    expect(codeFor(null, "common")).toBeNull();
  });
});

describe("readStats", () => {
  it("reads a live weapon row: attack, crit, then the durability as the last percentage before the price", () => {
    const r = readStats([
      "101",
      "16%",
      "100%",
      "Pyle_prapyle",
      "now",
      "40.4",
      "BUY",
    ]);
    expect(r).toEqual({
      readable: true,
      durability: 100,
      stat: 101,
      stats: [101, 16],
      reason: null,
    });
  });
  it("reads a live armour row whose stat is printed as a percentage, and one printed bare", () => {
    expect(
      readStats(["12%", "100%", "Oldehove", "32m", "13.45", "BUY"]),
    ).toEqual({
      readable: true,
      durability: 100,
      stat: 12,
      stats: [12],
      reason: null,
    });
    expect(
      readStats(["46", "84%", "Seller", "1h", "120", "BUY"]),
    ).toMatchObject({
      durability: 84,
      stat: 46,
      stats: [46],
    });
  });
  it("accepts a named stat and a plus sign, and ignores lines after BUY", () => {
    expect(readStats(["Attack: 312", "100%", "12", "BUY", "99"]).stat).toBe(
      312,
    );
    expect(readStats(["+45", "100%", "1.5", "BUY"]).stat).toBe(45);
    expect(readStats(["100%", "1", "BUY", "7"]).stat).toBeNull();
  });
  it("fails closed and says why", () => {
    expect(readStats(["270", "100%", "430.5"])).toMatchObject({
      readable: false,
      reason: "no BUY control",
    });
    expect(readStats(["270", "430.5", "BUY"])).toMatchObject({
      readable: false,
      durability: null,
      stat: 270,
      reason: "no durability",
    });
    expect(readStats(["100%", "430.5", "BUY"])).toMatchObject({
      readable: false,
      reason: "no stat value",
    });
    expect(readStats(["Seller", "430.5", "BUY"]).reason).toBe(
      "no durability or stat",
    );
    expect(readStats(["270", "150%", "430.5", "BUY"])).toMatchObject({
      durability: null,
      stats: [270],
    });
    expect(readStats(null).readable).toBe(false);
  });
});

describe("summarizeOffers", () => {
  it("counts readable stats, prices and rarities independently of each other", () => {
    const rows = [
      { stats: { readable: true }, price: 1, rarity: "common" },
      { stats: { readable: true }, price: null, rarity: null },
      { stats: { readable: false }, price: 2, rarity: "rare" },
      { stats: null, price: null, rarity: "epic" },
    ];
    expect(summarizeOffers(rows)).toEqual({
      scanned: 4,
      readable: 2,
      priced: 2,
      rarityKnown: 3,
    });
  });
});

describe("statRanks", () => {
  const row = (code, stat) => ({ code, stats: { readable: true, stat } });
  it("ranks a row among eight or more peers of the same code only", () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, i) => row("jet", 100 + i * 10)),
      row("tank", 50),
      row("tank", 60),
      { code: "jet", stats: { readable: false, stat: null } },
    ];
    const ranks = statRanks(rows);
    expect(ranks[0].status).toBe("ok");
    expect(ranks[0].n).toBe(8);
    expect(ranks[0].percentile).toBe(0);
    expect(ranks[8].percentile).toBe(100);
    expect(ranks[4].percentile).toBe(50);
    expect(ranks[9].status).toBe("insufficient");
    expect(ranks[9].n).toBe(1);
    expect(ranks[11]).toBeNull();
  });
  it("needs eight peers besides the row itself: eight rows of one code are seven peers", () => {
    const ranks = statRanks(
      Array.from({ length: 8 }, (_, i) => row("boots5", 10 + i)),
    );
    expect(ranks.every((r) => r.status === "insufficient" && r.n === 7)).toBe(
      true,
    );
  });
});

describe("offerDimensions", () => {
  it("keeps stat readability apart from the quote and from the sales read", () => {
    const readable = { readable: true };
    expect(
      offerDimensions({
        stats: readable,
        hasQuote: true,
        fresh: true,
        salesError: "boom",
      }),
    ).toEqual({
      stats: "readable",
      market: "available",
      freshness: "fresh",
      resale: "error",
    });
    expect(
      offerDimensions({
        stats: readable,
        hasQuote: false,
        fresh: false,
        error: "offline",
      }),
    ).toMatchObject({
      stats: "readable",
      market: "error",
      freshness: "missing",
    });
    expect(
      offerDimensions({
        stats: { readable: false },
        hasQuote: true,
        fresh: false,
        resale: { status: "ok" },
      }),
    ).toEqual({
      stats: "unreadable",
      market: "available",
      freshness: "stale",
      resale: "ok",
    });
  });
  it("tells loading, insufficient and another item's sales apart", () => {
    expect(
      offerDimensions({ hasQuote: true, fresh: true, salesLoading: true })
        .resale,
    ).toBe("loading");
    expect(
      offerDimensions({
        hasQuote: true,
        fresh: true,
        resale: { status: "insufficient" },
      }).resale,
    ).toBe("insufficient");
    expect(
      offerDimensions({
        hasQuote: true,
        fresh: true,
        ownItem: false,
        salesError: "x",
      }).resale,
    ).toBe("other-item");
    expect(offerDimensions({ hasQuote: true, fresh: true }).resale).toBe(
      "none",
    );
  });
});
