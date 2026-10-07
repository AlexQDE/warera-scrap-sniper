import { describe, it, expect } from "vitest";
import { craftCost, tierBoard, bestTier } from "./craftboard.mjs";
import { ALL_GEAR_CODES } from "./items.mjs";

const deep = (price) => [{ price, quantity: 1e6 }];
const avgAll = (value) =>
  Object.fromEntries(ALL_GEAR_CODES.map((c) => [c, value]));

describe("craftCost", () => {
  it("walks the scraps and the steel through their asks and names what the depth does not cover", () => {
    expect(
      craftCost({
        scraps: 162,
        steel: 8,
        scrapAsks: [
          { price: 0.2, quantity: 100 },
          { price: 0.25, quantity: 100 },
        ],
        steelAsks: deep(1.5),
      }),
    ).toEqual({
      value: 100 * 0.2 + 62 * 0.25 + 12,
      complete: true,
      missing: [],
    });
    expect(
      craftCost({
        scraps: 1458,
        steel: 32,
        scrapAsks: [{ price: 0.2, quantity: 1000 }],
        steelAsks: [],
      }),
    ).toEqual({ value: null, complete: false, missing: ["scraps", "steel"] });
  });
});

describe("tierBoard", () => {
  it("prices every tier: random EV over the six slots' averages, the best chosen slot, and the reroll loss", () => {
    const avg = {
      ...avgAll(null),
      // epic: weapon 50, armour 20 each -> random EV 0.3*50 + 5*0.14*20 = 29
      sniper: 50,
      helmet4: 20,
      chest4: 20,
      gloves4: 20,
      pants4: 20,
      boots4: 20,
    };
    const rows = tierBoard({
      scrapAsks: deep(0.2),
      scrapBids: deep(0.19),
      steelAsks: deep(1.5),
      avg,
    });
    expect(rows).toHaveLength(6);
    const epic = rows[3];
    expect(epic).toMatchObject({
      rarity: "epic",
      tier: 4,
      scraps: 162,
      steelRandom: 8,
      steelChosen: 16,
      covered: 6,
    });
    expect(epic.costRandom.value).toBeCloseTo(162 * 0.2 + 8 * 1.5, 6); // 44.4
    expect(epic.costChosen.value).toBeCloseTo(162 * 0.2 + 16 * 1.5, 6); // 56.4
    expect(epic.evRandom).toBeCloseTo(29, 6);
    expect(epic.roiRandom).toBeCloseTo((29 - 44.4) / 44.4, 6);
    expect(epic.best).toMatchObject({
      code: "sniper",
      slot: "weapon",
      avg: 50,
    });
    expect(epic.roiChosen).toBeCloseTo((50 - 56.4) / 56.4, 6);
    expect(epic.scrapsBack).toBeCloseTo(162 * 0.19, 6);
    expect(epic.lossRandom).toBeCloseTo(44.4 - 162 * 0.19, 6);
    // a tier without averages has a cost but no value, never a guessed EV
    const mythic = rows[5];
    expect(mythic.costRandom.value).toBeCloseTo(1458 * 0.2 + 32 * 1.5, 6);
    expect(mythic.evRandom).toBeNull();
    expect(mythic.roiRandom).toBeNull();
    expect(mythic.best).toBeNull();
    expect(mythic.covered).toBe(0);
  });
  it("withholds the random EV while any slot lacks an average, and still names the best covered slot", () => {
    const avg = { ...avgAll(null), jet: 480, helmet6: 430 };
    const [, , , , , mythic] = tierBoard({
      scrapAsks: deep(0.25),
      steelAsks: deep(1.8),
      avg,
    });
    expect(mythic.covered).toBe(2);
    expect(mythic.evRandom).toBeNull();
    expect(mythic.best).toMatchObject({ code: "jet", avg: 480 });
    expect(mythic.roiChosen).toBeCloseTo(
      (480 - (1458 * 0.25 + 64 * 1.8)) / (1458 * 0.25 + 64 * 1.8),
      6,
    );
    expect(mythic.scrapsBack).toBeNull(); // no bids given
    expect(mythic.lossRandom).toBeNull();
  });
  it("treats a zero or malformed average as no average", () => {
    const [common] = tierBoard({
      scrapAsks: deep(0.2),
      steelAsks: deep(1.5),
      avg: { knife: 0, helmet1: "x", chest1: -1, gloves1: null },
    });
    expect(common.covered).toBe(0);
    expect(common.best).toBeNull();
  });
});

describe("bestTier", () => {
  it("picks the highest random ROI, falling back to the chosen-slot ROI when no tier is fully covered", () => {
    const rows = tierBoard({
      scrapAsks: deep(0.2),
      steelAsks: deep(1.5),
      avg: { ...avgAll(10), knife: 100 },
    });
    // common: cost 1.2 + 1.5 = 2.7, random EV 0.3*100 + 0.7*10 = 37 -> the best by far
    expect(bestTier(rows)).toMatchObject({
      mode: "random",
      row: { rarity: "common" },
    });
    const partial = tierBoard({
      scrapAsks: deep(0.2),
      steelAsks: deep(1.5),
      avg: { jet: 10_000, knife: 5 },
    });
    expect(bestTier(partial)).toMatchObject({
      mode: "chosen",
      row: { rarity: "mythic" },
    });
    expect(bestTier(tierBoard({ avg: {} }))).toBeNull();
  });
});
