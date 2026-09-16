import { describe, it, expect } from "vitest";
import { positive, quote, freshness } from "./quality.mjs";
import { preferences } from "./settings.mjs";
import { verdict } from "./dom.mjs";
import {
  caseVerdict,
  caseScrapQuote,
  woodenCaseValue,
  WOODEN_CODES,
  tripCost,
} from "./cases.mjs";
import { parseBook, fetchBook, fetchEquipmentAvg } from "./api.mjs";

describe("quote quality and safe decisions", () => {
  it("walks multiple price levels and refuses unobserved liquidity", () => {
    const levels = [
      { price: 0.3, quantity: 2 },
      { price: 0.2, quantity: 8 },
    ];
    expect(quote(6, levels)).toMatchObject({
      value: 1.4,
      filled: 6,
      complete: true,
    });
    expect(quote(11, levels)).toMatchObject({
      value: null,
      filled: 10,
      complete: false,
    });
    expect(quote(0, [])).toMatchObject({ value: 0, complete: true });
    expect(quote(1.5, levels).complete).toBe(false);
    expect(quote(3, [{ price: 0.1, quantity: 3 }]).value).toBe(0.3);
  });
  it("aggregates and sorts book levels, with explicit depth caps", () => {
    const b = parseBook(
      {
        buyOrders: [
          { price: 1, quantity: 2 },
          { price: 2, quantity: 3 },
          { price: 1, quantity: 4 },
        ],
        sellOrders: [],
      },
      3,
    );
    expect(b.bids).toEqual([
      { price: 2, quantity: 3 },
      { price: 1, quantity: 6 },
    ]);
    expect(b.bidCapped).toBe(true);
    expect(b.ask).toBeNull();
    for (const price of [0, -1, NaN, null, ""])
      expect(() =>
        parseBook({ buyOrders: [{ price, quantity: 3 }], sellOrders: [] }),
      ).toThrow();
    expect(() => parseBook({ buyOrders: [] })).toThrow();
  });
  it("makes missing, future and expired quotes non-actionable", () => {
    expect(freshness(null, 30000, 100000)).toBe("missing");
    expect(freshness("invalid", 30000, 100000)).toBe("missing");
    expect(freshness(new Date(110000).toISOString(), 30000, 100000)).toBe(
      "missing",
    );
    expect(freshness(new Date(70000).toISOString(), 30000, 100000)).toBe(
      "stale",
    );
    expect(freshness(new Date(70001).toISOString(), 30000, 100000)).toBe(
      "fresh",
    );
    for (const n of [null, undefined, 0, -1, Infinity, NaN, "", true])
      expect(positive(n)).toBeNull();
  });
  it("never labels a loss as SNIPE even with a negative threshold", () => {
    expect(verdict({ price: 10.4, floor: 10, minMarginPct: -5 })).toMatchObject(
      { hit: false, near: true },
    );
    expect(verdict({ price: 10, floor: 10, minMarginPct: -5 })).toMatchObject({
      hit: true,
    });
  });
  it("requires every possible drop to have observed liquidity", () => {
    expect(
      caseScrapQuote("case1", [{ price: 1, quantity: 100 }]).complete,
    ).toBe(false);
    const w = woodenCaseValue(
      () => 1,
      "floor",
      (code, qty) =>
        quote(qty, [
          { price: 1, quantity: code === WOODEN_CODES[0] ? 1 : 1000 },
        ]),
    );
    expect(w.complete).toBe(false);
    expect(
      caseVerdict({ bid: 100, openValue: 5, complete: false }).verdict,
    ).toBeNull();
  });
  it("checks the entire wooden floor/round band before recommending", () => {
    expect(
      caseVerdict({ bid: 11, openValue: 10, band: [10, 11] }).verdict,
    ).toBe("even");
  });
  it("validates preferences and treats unknown distance differently from zero", () => {
    expect(
      preferences({ intervalSec: 10000, minMarginPct: -100 }),
    ).toMatchObject({ intervalSec: 600, minMarginPct: -50 });
    expect(() => tripCost({ hops: null, oilAsk: 1, value: 10 })).toThrow(
      RangeError,
    );
    expect(tripCost({ hops: 0, oilAsk: null, value: 10 }).oilGold).toBe(0);
  });
  it("does not turn missing auth headers into a falsely rejected key", async () => {
    await expect(
      fetchBook(
        async () => ({ ok: true, status: 200, headers: new Headers() }),
        "fake",
      ),
    ).rejects.toMatchObject({ code: "auth-unverified" });
  });
  it("distinguishes valid no-history zero from a malformed average response", async () => {
    const f = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "ratelimit-limit": "500" }),
      json: async () => [
        { result: { data: 0 } },
        { result: { data: { unexpected: 12 } } },
      ],
    });
    const r = await fetchEquipmentAvg(f, "fake", ["knife", "jet"]);
    expect(r.failures.knife).toBeUndefined();
    expect(r.failures.jet).toBeTruthy();
  });
});
