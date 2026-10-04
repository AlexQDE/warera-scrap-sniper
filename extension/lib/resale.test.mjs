import { describe, it, expect } from "vitest";
import {
  MIN_RESALE_SAMPLE,
  MIN_PERCENTILE_PEERS,
  comparableFills,
  percentile,
  resaleEstimate,
  percentileRank,
  listingScenarios,
  liquidity,
} from "./resale.mjs";

// Fills as fetchSales returns them: price as recorded by the feed, ISO time,
// durability state, item code.
const NOW = Date.parse("2026-10-03T12:00:00.000Z");
const h = (hoursAgo) => new Date(NOW - hoursAgo * 3600e3).toISOString();
const fill = (price, hoursAgo, extra = {}) => ({
  price,
  at: h(hoursAgo),
  state: 100,
  code: "jet",
  ...extra,
});
const fills = (prices) => prices.map((p, i) => fill(p, i + 0.5));

describe("comparableFills", () => {
  it("keeps the item's own positive, dated fills inside the window, newest first", () => {
    const list = comparableFills(
      [
        fill(380, 1),
        fill(370, 80), // outside 72 h
        fill(390, 0.2),
        fill(0, 2), // free is not a price
        fill(400, 3, { code: "tank" }),
        fill(410, -1), // the future
        { price: "390", at: h(1) }, // strings are not read as numbers
        fill(360, 2, { at: "yesterday" }),
      ],
      { code: "jet", now: NOW },
    );
    expect(list.map((f) => f.price)).toEqual([390, 380]);
  });
  it("matches durability within tolerance only when the offer's own is known, and never a fill without one", () => {
    const list = [
      fill(100, 1, { state: 100 }),
      fill(90, 2, { state: 92 }),
      fill(80, 3, { state: 70 }),
      fill(70, 4, { state: null }),
    ];
    expect(comparableFills(list, { now: NOW }).map((f) => f.price)).toEqual([
      100, 90, 80, 70,
    ]);
    expect(
      comparableFills(list, { now: NOW, state: 100 }).map((f) => f.price),
    ).toEqual([100, 90]);
    expect(
      comparableFills(list, { now: NOW, state: 75, stateTolerance: 5 }).map(
        (f) => f.price,
      ),
    ).toEqual([80]);
  });
});

describe("percentile", () => {
  it("interpolates linearly and copes with one value", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4], 100)).toBe(4);
    expect(percentile([1, 2, 3, 4, 5], 25)).toBe(2);
    expect(percentile([7], 25)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("resaleEstimate thresholds", () => {
  it("has no estimate for four comparable fills, only the observed range", () => {
    const est = resaleEstimate(fills([400, 380, 390, 370]), { now: NOW });
    expect(est.status).toBe("insufficient");
    expect(est.n).toBe(4);
    expect(est.needed).toBe(MIN_RESALE_SAMPLE);
    expect(est.estimate).toBeNull();
    expect(est.low).toBe(370);
    expect(est.high).toBe(400);
    expect(est.p25).toBeNull();
    expect(est.quartiles).toBe(false);
  });
  it("supports the median from exactly five fills, without quartiles", () => {
    const est = resaleEstimate(fills([400, 380, 390, 370, 385]), { now: NOW });
    expect(est.status).toBe("ok");
    expect(est.n).toBe(5);
    expect(est.estimate).toBe(385);
    expect(est.low).toBe(370);
    expect(est.high).toBe(400);
    expect(est.p25).toBeNull();
    expect(est.p75).toBeNull();
    expect(est.quartiles).toBe(false);
    expect(est.uncertaintyPct).toBeCloseTo((5 / 385) * 100, 9); // MAD of 5, 5, 10, 15, 0 = 5
  });
  it("still withholds quartiles at seven fills and grants them at eight", () => {
    const seven = resaleEstimate(fills([1, 2, 3, 4, 5, 6, 7]), { now: NOW });
    expect(seven.status).toBe("ok");
    expect(seven.estimate).toBe(4);
    expect(seven.quartiles).toBe(false);
    expect(seven.p25).toBeNull();
    const eight = resaleEstimate(fills([1, 2, 3, 4, 5, 6, 7, 8]), {
      now: NOW,
    });
    expect(eight.n).toBe(MIN_PERCENTILE_PEERS);
    expect(eight.quartiles).toBe(true);
    expect(eight.estimate).toBe(4.5);
    expect(eight.p25).toBe(2.75);
    expect(eight.p75).toBe(6.25);
  });
  it("counts only comparable fills toward the bar, so five fills with one wrong item stay insufficient", () => {
    const list = fills([400, 380, 390, 370, 385]);
    list[4] = { ...list[4], code: "tank" };
    const est = resaleEstimate(list, { code: "jet", now: NOW });
    expect(est.status).toBe("insufficient");
    expect(est.n).toBe(4);
    const none = resaleEstimate(list, { code: "knife", now: NOW });
    expect(none.status).toBe("insufficient"); // fills were read, none compare: 0 of 5, not "nothing read"
    expect(none.n).toBe(0);
  });
  it("is empty, not broken, without fills and carries the window and cap through", () => {
    const est = resaleEstimate([], { now: NOW, capped: true, hours: 48 });
    expect(est.status).toBe("none");
    expect(est.n).toBe(0);
    expect(est.estimate).toBeNull();
    expect(est.low).toBeNull();
    expect(est.capped).toBe(true);
    expect(est.windowHours).toBe(48);
    expect(est.spanHours).toBe(0);
    expect(est.lastAt).toBeNull();
  });
  it("reports how far back the sample reaches and when it was last added to", () => {
    const est = resaleEstimate(fills([1, 2, 3, 4, 5]), { now: NOW });
    expect(est.lastAt).toBe(h(0.5));
    expect(est.spanHours).toBeCloseTo(4.5, 9); // the oldest of the five sits 4.5 h back
  });
});

describe("percentileRank thresholds", () => {
  it("refuses a rank over seven peers and grants it over eight", () => {
    const seven = percentileRank(5, [1, 2, 3, 4, 6, 7, 8]);
    expect(seven.status).toBe("insufficient");
    expect(seven.n).toBe(7);
    expect(seven.needed).toBe(MIN_PERCENTILE_PEERS);
    expect(seven.percentile).toBeNull();
    const eight = percentileRank(5, [1, 2, 3, 4, 6, 7, 8, 9]);
    expect(eight.status).toBe("ok");
    expect(eight.percentile).toBe(50);
  });
  it("counts ties as half, drops invalid peers, and pins the ends", () => {
    expect(
      percentileRank(5, [5, 5, 1, 2, 3, 4, 6, 7, "x", NaN, 0, -1]).percentile,
    ).toBe(((4 + 1) / 8) * 100);
    expect(percentileRank(0.5, [1, 2, 3, 4, 5, 6, 7, 8]).percentile).toBe(0);
    expect(percentileRank(9, [1, 2, 3, 4, 5, 6, 7, 8]).percentile).toBe(100);
    expect(percentileRank(null, [1, 2, 3, 4, 5, 6, 7, 8]).status).toBe("none");
    expect(percentileRank(3, []).status).toBe("none");
  });
});

describe("listingScenarios", () => {
  it("offers only the balanced median with five fills, all three with eight", () => {
    const five = listingScenarios(
      resaleEstimate(fills([400, 380, 390, 370, 385]), { now: NOW }),
    );
    expect(Object.keys(five)).toEqual(["balanced"]);
    expect(five.balanced.price).toBe(385);
    const eight = listingScenarios(
      resaleEstimate(fills([1, 2, 3, 4, 5, 6, 7, 8]), { now: NOW }),
    );
    expect(Object.keys(eight).sort()).toEqual(["balanced", "patient", "quick"]);
    expect(eight.quick.price).toBeLessThan(eight.balanced.price);
    expect(eight.balanced.price).toBeLessThan(eight.patient.price);
    expect(eight.quick.basis).toContain("8 fills");
  });
  it("offers nothing without an estimate", () => {
    expect(
      listingScenarios(resaleEstimate(fills([1, 2, 3]), { now: NOW })),
    ).toEqual({});
  });
});

describe("liquidity", () => {
  it("is quiet without fills and measures pace from two or more", () => {
    expect(liquidity([], { now: NOW })).toEqual({
      n: 0,
      perDay: 0,
      medianGapHours: null,
      lastHour: 0,
      lastAt: null,
    });
    const one = liquidity([fill(1, 2)], { now: NOW });
    expect(one.n).toBe(1);
    expect(one.medianGapHours).toBeNull();
    expect(one.perDay).toBe(12); // one fill over a two-hour span
    const l = liquidity(
      [fill(1, 0.5), fill(1, 2.5), fill(1, 4.5), fill(1, 48)],
      {
        now: NOW,
      },
    );
    expect(l.n).toBe(4);
    expect(l.medianGapHours).toBe(2);
    expect(l.lastHour).toBe(1);
    expect(l.perDay).toBe(2);
    expect(l.lastAt).toBe(h(0.5));
  });
});
