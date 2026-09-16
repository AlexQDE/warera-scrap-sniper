import { describe, it, expect } from "vitest";
import {
  CASE_ODDS,
  GEAR_CODES,
  ALL_GEAR_CODES,
  WOODEN_CODES,
  caseScrapQuote,
  casesSummary,
  snapshotSummary,
  sellsRarity,
  policyLabel,
  rarityResaleValue,
  casePolicyValue,
} from "./cases.mjs";
import { casesStripHtml } from "./casesview.mjs";

// The drop policy (editor, 2026-09-16): scrap the cheap rarities, sell the
// expensive ones at the game's average item price. `sellFrom` names the first
// rarity that is sold.
const deep = [{ price: 0.222, quantity: 1e6 }];
const avg100 = () => 100;

describe("the drop policy", () => {
  it("knows which rarities a threshold sells", () => {
    expect(sellsRarity("never", "mythic")).toBe(false);
    expect(sellsRarity("common", "common")).toBe(true);
    expect(sellsRarity("epic", "rare")).toBe(false);
    expect(sellsRarity("epic", "epic")).toBe(true);
    expect(sellsRarity("epic", "mythic")).toBe(true);
    expect(sellsRarity("mythic", "legendary")).toBe(false);
    expect(sellsRarity("bogus", "mythic")).toBe(false);
    expect(policyLabel("epic")).toBe("scrap ≤ rare · sell ≥ epic at avg");
    expect(policyLabel("common")).toBe("sell all drops at avg");
    expect(policyLabel("never")).toBe("scrap-only EV");
  });

  it("values an open as odds x (scrap quote below the threshold, resale from it)", () => {
    const p = casePolicyValue("case1", {
      bids: deep,
      avgOf: avg100,
      sellFrom: "epic",
    });
    const odds = CASE_ODDS.case1.rarity;
    const expected =
      odds.common * 6 * 0.222 +
      odds.uncommon * 18 * 0.222 +
      odds.rare * 54 * 0.222 +
      (odds.epic + odds.legendary + odds.mythic) * 100;
    expect(p.value).toBeCloseTo(expected, 6);
    expect(p.selling).toBe(true);
    expect(p.complete).toBe(true);
    expect(p.rows.map((r) => r.mode)).toEqual([
      "scrap",
      "scrap",
      "scrap",
      "sell",
      "sell",
      "sell",
    ]);
    expect(p.rows[3].priced).toBe("6/6");
    expect(
      casePolicyValue("case1", { bids: deep, avgOf: avg100, sellFrom: "never" })
        .value,
    ).toBeCloseTo(caseScrapQuote("case1", deep).value, 6);
    expect(
      casePolicyValue("case1", {
        bids: deep,
        avgOf: avg100,
        sellFrom: "common",
      }).value,
    ).toBeCloseTo(100, 6);
  });

  it("weights the weapon at its share and renormalises over the priced codes", () => {
    const avgOf = (code) =>
      code === "jet" ? 400 : code === "helmet6" ? 100 : null;
    const r = rarityResaleValue("mythic", CASE_ODDS.case1, avgOf);
    const w = CASE_ODDS.case1.weaponShare;
    const g = (1 - w) / 5;
    expect(r.unit).toBeCloseTo((w * 400 + g * 100) / (w + g), 6);
    expect(r.priced).toBe(2);
    expect(r.total).toBe(6);
    expect(
      rarityResaleValue("mythic", CASE_ODDS.case1, () => 0).unit,
    ).toBeNull();
  });

  it("falls back to the scrap quote for a rarity without any average, flagged, never imputed", () => {
    const avgOf = (code) => (/6$|jet/.test(code) ? null : 100);
    const p = casePolicyValue("case2", { bids: deep, avgOf, sellFrom: "epic" });
    const mythic = p.rows.find((r) => r.rarity === "mythic");
    expect(mythic.mode).toBe("scrap");
    expect(mythic.fallback).toBe(true);
    expect(mythic.unit).toBeCloseTo(1458 * 0.222, 6);
    expect(p.selling).toBe(true);
    expect(p.complete).toBe(true);
    const none = casePolicyValue("case2", {
      bids: deep,
      avgOf: () => null,
      sellFrom: "epic",
    });
    expect(none.selling).toBe(false);
    expect(none.value).toBeCloseTo(caseScrapQuote("case2", deep).value, 6);
  });

  it("is incomplete when the scrap book cannot absorb a scrapped rarity", () => {
    const thin = [{ price: 0.222, quantity: 10 }]; // a rare drop needs 54 scraps sold
    const p = casePolicyValue("case1", {
      bids: thin,
      avgOf: avg100,
      sellFrom: "epic",
    });
    expect(p.complete).toBe(false);
    expect(p.value).toBeNull();
  });
});

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
const books = Object.fromEntries(
  Object.entries(BIDS).map(([code, bid]) => [
    code,
    {
      bid,
      ask: bid * 1.01,
      bidQty: 20000,
      askQty: 20000,
      bids: [{ price: bid, quantity: 1e6 }],
      asks: [{ price: bid * 1.01, quantity: 20000 }],
    },
  ]),
);
const avg = Object.fromEntries(
  Object.values(GEAR_CODES)
    .flatMap((g) => [g.weapon, ...g.gear])
    .map((c) => [c, 100]),
);

describe("casesSummary with a drop policy", () => {
  it("prices battle cases by the policy and names it, the wooden case untouched", () => {
    const s = casesSummary({ books, avg, sellFrom: "epic" });
    const c1 = s.rows[1];
    expect(c1.basis).toBe("scrap ≤ rare · sell ≥ epic at avg");
    expect(c1.openValue).toBeCloseTo(
      casePolicyValue("case1", {
        bids: books.scraps.bids,
        avgOf: () => 100,
        sellFrom: "epic",
      }).value,
      6,
    );
    expect(c1.openScrap).toBeCloseTo(
      caseScrapQuote("case1", books.scraps.bids).value,
      6,
    );
    expect(c1.openMarket).toBeCloseTo(100, 6);
    expect(c1.policy.rows).toHaveLength(6);
    expect(s.rows[0].openValue).toBeCloseTo(6.117759, 5);
    const all = casesSummary({ books, avg, sellFrom: "common" });
    expect(all.rows[1].openValue).toBeCloseTo(100, 6);
    expect(all.rows[1].verdict).toBe("open");
  });

  it("stands on the scrap-only quote without a policy or without averages", () => {
    const never = casesSummary({ books, avg, sellFrom: "never" });
    expect(never.rows[1].basis).toBe("scrap-only EV");
    expect(never.rows[1].openValue).toBe(never.rows[1].openScrap);
    const noAvg = casesSummary({ books, avg: null, sellFrom: "epic" });
    expect(noAvg.rows[1].basis).toBe("scrap-only EV (no average prices yet)");
    expect(noAvg.rows[1].openValue).toBe(noAvg.rows[1].openScrap);
    expect(WOODEN_CODES).toHaveLength(20);
  });

  it("memoises per snapshot and policy", () => {
    const a = snapshotSummary({ books, avg, sellFrom: "epic" });
    expect(snapshotSummary({ books, avg, sellFrom: "epic" })).toBe(a);
    expect(snapshotSummary({ books, avg, sellFrom: "never" })).not.toBe(a);
  });
});

describe("drop policy rendering", () => {
  const NOW = Date.parse("2026-09-16T10:00:00Z");
  const at = new Date(NOW - 12000).toISOString();
  const cases = { at, books };
  const avgSnapshot = {
    values: Object.fromEntries(ALL_GEAR_CODES.map((c) => [c, 100])),
    times: Object.fromEntries(ALL_GEAR_CODES.map((c) => [c, at])),
  };
  it("names the policy, prices the open by it and lists each rarity", () => {
    const html = casesStripHtml({
      cases: { ...cases, avg: avgSnapshot },
      now: NOW,
      sellFrom: "epic",
    });
    expect(html).toContain("scrap ≤ rare · sell ≥ epic at avg");
    expect(html).toContain("epic sell");
    expect(html).toContain("common scrap");
    expect(html).toContain("Scrap-only floor");
    const all = casesStripHtml({
      cases: { ...cases, avg: avgSnapshot },
      now: NOW,
      sellFrom: "common",
    });
    expect(all).toContain("sell all drops at avg");
    expect(all).toContain('data-verdict="open"');
  });
  it("says so when the averages are not there yet and stays on scrap", () => {
    const html = casesStripHtml({ cases, now: NOW, sellFrom: "epic" });
    expect(html).toContain("scrap-only EV (no average prices yet)");
    expect(html).not.toContain('data-verdict="open"');
  });
});
