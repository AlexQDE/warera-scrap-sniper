import { describe, it, expect } from "vitest";
import {
  WOODEN_TIERS,
  WOODEN_PP,
  CASE_ODDS,
  GEAR_CODES,
  expectedQty,
  woodenCaseValue,
  caseScrapValue,
  caseMarketValue,
  caseScrapQuote,
  caseVerdict,
  tripCost,
  regionsAwayFromText,
  casesSummary,
} from "./cases.mjs";

// Best bids pinned 2026-09-16T09:26Z (data/woodcase/pin-2026-09-16T09-26-23-574Z.json),
// the pin src/woodcase/sim.mjs prints as "open EV at bid: 6.12 gold (floor) / 6.52 (round)".
const BIDS = {
  cookedFish: 7.981,
  heavyAmmo: 2.673,
  cocain: 36.702,
  ammo: 0.685,
  steak: 3.795,
  concrete: 2.002,
  steel: 1.794,
  bread: 1.945,
  oil: 0.241,
  paper: 0.197,
  lightAmmo: 0.181,
  grain: 0.082,
  iron: 0.091,
  wood: 0.09,
  lead: 0.085,
  limestone: 0.105,
  coca: 0.082,
  petroleum: 0.117,
  livestock: 1.531,
  fish: 3.37,
  scraps: 0.222,
  case1: 3.439,
  case2: 21.701,
  woodenCase: 7.55,
};
const bidOf = (c) => BIDS[c] ?? null;

describe("the wooden case rules", () => {
  it("carries the four tiers of the patch notes, 20 resources, 100% in all", () => {
    expect(WOODEN_TIERS.map((t) => t.pct)).toEqual([2, 13, 20, 65]);
    expect(WOODEN_TIERS.flatMap((t) => t.items)).toHaveLength(20);
    expect(WOODEN_TIERS.reduce((s, t) => s + t.pct, 0)).toBe(100);
    for (const code of WOODEN_TIERS.flatMap((t) => t.items))
      expect(WOODEN_PP[code]).toBeGreaterThan(0);
  });

  it("expects the budget divided by the production points, floored, never below one", () => {
    expect(expectedQty(40)).toBeCloseTo(62 / 61, 6); // 20..39 -> 1 (floor 0 lifted), 40..79 -> 1, 80 -> 2
    expect(expectedQty(16)).toBeCloseTo(161 / 61, 6);
    expect(expectedQty(1)).toBe(50);
    expect(expectedQty(200)).toBe(1);
    expect(expectedQty(40, "round")).toBeCloseTo(
      (20 * 1 + 20 * 1 + 20 * 2 + 1 * 2) / 61,
      6,
    ); // 20..39 -> 1 (0 or 1 lifted to 1), 40..59 -> 1, 60..80 -> 2
  });

  it("opens for 6.12 gold at the pinned bids (round rule 6.52 as the band)", () => {
    const v = woodenCaseValue(bidOf);
    expect(v.ev).toBeCloseTo(6.117759, 5);
    expect(v.evRound).toBeCloseTo(6.516059, 5);
    expect(v.complete).toBe(true);
    expect(v.rows).toHaveLength(20);
    expect(v.rows.find((r) => r.code === "oil").gold).toBeCloseTo(12.05, 6);
    expect(v.tiers.map((t) => t.tier)).toEqual([
      "epic",
      "rare",
      "uncommon",
      "common",
    ]);
  });

  it("values a case with a missing price as incomplete, over the rest", () => {
    const v = woodenCaseValue((c) => (c === "cocain" ? null : BIDS[c]));
    expect(v.complete).toBe(false);
    expect(v.missing).toEqual(["cocain"]);
    expect(v.ev).toBeLessThan(6.117759);
  });
});

describe("the battle cases", () => {
  it("scrap the audited number of scraps per open, never the codex figure", () => {
    expect(CASE_ODDS.case1.scrapsPerCase).toBeCloseTo(14.7188, 4);
    expect(CASE_ODDS.case2.scrapsPerCase).toBeCloseTo(67.499, 3);
    expect(caseScrapValue("case1", 0.222)).toBeCloseTo(3.26757, 4);
    expect(caseScrapValue("case2", 0.222)).toBeCloseTo(14.9848, 3);
    expect(caseScrapValue("woodenCase", 0.222)).toBeNull();
    expect(caseScrapValue("case1", null)).toBeNull();
  });

  it("lists the 36 gear codes, six a rarity, one weapon each", () => {
    expect(Object.keys(GEAR_CODES)).toEqual([
      "common",
      "uncommon",
      "rare",
      "epic",
      "legendary",
      "mythic",
    ]);
    for (const r of Object.keys(GEAR_CODES)) {
      expect(GEAR_CODES[r].gear).toHaveLength(5);
      expect(typeof GEAR_CODES[r].weapon).toBe("string");
    }
    expect(GEAR_CODES.mythic.weapon).toBe("jet");
    expect(GEAR_CODES.uncommon.gear).toContain("pants2");
  });

  it("values an open at the average item price, weighted by the audited rarity odds and the 30% weapon share", () => {
    const tier = {
      common: 1,
      uncommon: 2,
      rare: 3,
      epic: 4,
      legendary: 5,
      mythic: 6,
    };
    const avgOf = (code) => {
      for (const [r, g] of Object.entries(GEAR_CODES))
        if (g.weapon === code || g.gear.includes(code)) return 100 * tier[r];
      return null;
    };
    const v = caseMarketValue("case1", avgOf);
    expect(v.value).toBeCloseTo(147.09, 1);
    expect(v.complete).toBe(true);
    expect(caseMarketValue("case2", avgOf).value).toBeCloseTo(
      0.503745 * 200 +
        0.324203 * 300 +
        0.143002 * 400 +
        0.025305 * 500 +
        0.003745 * 600,
      1,
    );
  });

  it("keeps missing items unpriced without imputing their probability share", () => {
    const avgOf = (code) =>
      code === "jet"
        ? null
        : code === "knife"
          ? 2
          : /1$/.test(code)
            ? 4
            : /6$/.test(code)
              ? 900
              : 10;
    const v = caseMarketValue("case1", avgOf);
    expect(v.complete).toBe(false);
    expect(v.missing).toEqual(["jet"]);
    expect(v.coverage).toBeLessThan(1);
    const none = caseMarketValue("case1", (code) =>
      /6$|jet/.test(code) ? null : 5,
    );
    expect(none.complete).toBe(false);
    expect(none.missing).toEqual(
      expect.arrayContaining(["jet", ...GEAR_CODES.mythic.gear]),
    );
    expect(caseMarketValue("woodenCase", avgOf).value).toBeNull();
  });
});

// The repo's rule (src/woodcase/sim.mjs sellStill): selling sealed beats opening
// when the bid clears the open value by 10%; opening wins by the same margin
// the other way; in between it is a coin the XP decides.
describe("caseVerdict", () => {
  it("says sell, open or even with the 10% rule", () => {
    expect(caseVerdict({ bid: 21.701, openValue: 14.92 })).toMatchObject({
      verdict: "sell",
    });
    expect(caseVerdict({ bid: 21.701, openValue: 14.92 }).ratio).toBeCloseTo(
      21.701 / 14.92,
      6,
    );
    expect(caseVerdict({ bid: 3.439, openValue: 3.2676 })).toMatchObject({
      verdict: "even",
    });
    expect(caseVerdict({ bid: 5, openValue: 6.5 })).toMatchObject({
      verdict: "open",
    });
    expect(caseVerdict({ bid: 5.5, openValue: 5 })).toMatchObject({
      verdict: "sell",
    });
  });

  it("has no verdict without both numbers", () => {
    expect(caseVerdict({ bid: null, openValue: 6 }).verdict).toBeNull();
    expect(caseVerdict({ bid: 6, openValue: 0 }).verdict).toBeNull();
  });
});

// Travel (v0.26 client, module 45429): 10 stamina a region when the bar covers
// the whole trip, else 2 oil a region for the whole trip, never both.
describe("tripCost", () => {
  it("prices a trip both ways and nets it against the case value", () => {
    const t = tripCost({ hops: 7, oilAsk: 0.242, value: 7.55 });
    expect(t.stamina).toBe(70);
    expect(t.oil).toBe(14);
    expect(t.oilGold).toBeCloseTo(3.388, 6);
    expect(t.netOneWay).toBeCloseTo(4.162, 6);
    expect(t.netRoundTrip).toBeCloseTo(0.774, 6);
    expect(t.breakevenHops).toBeCloseTo(15.599, 2);
    expect(t.paysOneWay).toBe(true);
    expect(t.paysRoundTrip).toBe(true);
  });

  it("is free on the bar and a loss past the breakeven", () => {
    const far = tripCost({ hops: 19, oilAsk: 0.242, value: 6.12 });
    expect(far.oil).toBe(38);
    expect(far.paysOneWay).toBe(false);
    expect(
      tripCost({ hops: 0, oilAsk: 0.242, value: 7.55 }).netOneWay,
    ).toBeCloseTo(7.55, 6);
    expect(tripCost({ hops: 3, oilAsk: null, value: 7.55 }).oilGold).toBeNull();
  });
});

describe("regionsAwayFromText", () => {
  it("reads the map menu subtitle, singular and plural, English and the untranslated Serbian catalog", () => {
    expect(regionsAwayFromText("7 regions away")).toBe(7);
    expect(regionsAwayFromText("1 region away")).toBe(1);
    expect(regionsAwayFromText("Nearest wooden case12 regions away")).toBe(12);
  });
  it("is null for the km fallback the game shows before the regions load, and for junk", () => {
    expect(regionsAwayFromText("1,230 km")).toBeNull();
    expect(regionsAwayFromText("")).toBeNull();
    expect(regionsAwayFromText(null)).toBeNull();
  });
});

describe("casesSummary", () => {
  const books = Object.fromEntries(
    Object.entries(BIDS).map(([code, bid]) => [
      code,
      {
        bid,
        ask: bid * 1.01,
        bidQty: 20000,
        askQty: 20000,
        bids: [{ price: bid, quantity: 20000 }],
        asks: [{ price: bid * 1.01, quantity: 20000 }],
      },
    ]),
  );
  const avg = Object.fromEntries(
    Object.values(GEAR_CODES)
      .flatMap((g) => [g.weapon, ...g.gear])
      .map((c) => [c, 10]),
  );

  it("gives one row per case with bid, open values and a verdict, plus the oil ask", () => {
    const s = casesSummary({ books, avg });
    expect(s.rows.map((r) => r.code)).toEqual(["woodenCase", "case1", "case2"]);
    const wooden = s.rows[0];
    expect(wooden.bid).toBe(7.55);
    expect(wooden.openValue).toBeCloseTo(6.117759, 5);
    expect(wooden.openScrap).toBeNull();
    expect(wooden.verdict).toBe("sell");
    const c1 = s.rows[1];
    expect(c1.openScrap).toBeCloseTo(
      caseScrapQuote("case1", books.scraps.bids).value,
      6,
    );
    expect(c1.openMarket).toBeCloseTo(10, 6);
    expect(c1.openValue).toBe(c1.openScrap); // resale is not instantly executable
    expect(c1.verdict).toBe("even");
    expect(s.oilAsk).toBeCloseTo(0.241 * 1.01, 6);
  });

  it("falls back to the scrap floor when the average prices are not there", () => {
    const s = casesSummary({ books, avg: null });
    expect(s.rows[1].openMarket).toBeNull();
    expect(s.rows[1].openValue).toBeCloseTo(
      caseScrapQuote("case1", books.scraps.bids).value,
      6,
    );
    expect(s.rows[1].verdict).toBe("even");
  });

  it("survives an empty book", () => {
    const s = casesSummary({ books: {}, avg: null });
    expect(s.rows[0].bid).toBeNull();
    expect(s.rows[0].verdict).toBeNull();
    expect(s.oilAsk).toBeNull();
  });
});

describe("caseMarketValue and a zero average", () => {
  it("never averages a zero in: a thin code pulls nothing toward zero", () => {
    const avgOf = (code) => (code === "jet" || code === "helmet6" ? 0 : 10);
    const v = caseMarketValue("case2", avgOf);
    expect(v.value).toBeLessThan(10);
    expect(v.complete).toBe(false);
    expect(v.missing).toEqual(expect.arrayContaining(["jet", "helmet6"]));
    const allZero = caseMarketValue("case2", () => 0);
    expect(allZero.value).toBeNull();
    expect(allZero.complete).toBe(false);
  });
});
