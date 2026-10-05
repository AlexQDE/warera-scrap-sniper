import { describe, it, expect } from "vitest";
import { STAT_RANGES, keyStat, bandOf, rollPosition } from "./stats.mjs";
import { CRAFT_CODES } from "./craftdata.mjs";

describe("stat ranges", () => {
  it("carries the game config's ranges for all 36 codes, every range a multiple of five wide", () => {
    expect(Object.keys(STAT_RANGES)).toHaveLength(36);
    for (const code of CRAFT_CODES) expect(STAT_RANGES[code]).toBeDefined();
    expect(STAT_RANGES.jet).toEqual({
      attack: [221, 300],
      criticalChance: [41, 50],
    });
    expect(STAT_RANGES.helmet5).toEqual({ criticalDamages: [91, 110] });
    expect(STAT_RANGES.chest6).toEqual({ armor: [56, 70] });
    expect(STAT_RANGES.pants4).toEqual({ armor: [21, 30] });
    expect(STAT_RANGES.gloves5).toEqual({ precision: [31, 40] });
    expect(STAT_RANGES.boots1).toEqual({ dodge: [1, 5] });
    for (const ranges of Object.values(STAT_RANGES))
      for (const [lo, hi] of Object.values(ranges))
        expect((hi - lo + 1) % 5).toBe(0);
  });
  it("names the pricing stat: the armour slot's one stat, critical chance for a weapon", () => {
    expect(keyStat("tank")).toBe("criticalChance");
    expect(keyStat("helmet5")).toBe("criticalDamages");
    expect(keyStat("chest5")).toBe("armor");
    expect(keyStat("gloves2")).toBe("precision");
    expect(keyStat("scraps")).toBeNull();
  });
  it("bands a roll into the fifth of its range the ledger site shows", () => {
    expect(bandOf("tank", "criticalChance", 32)).toEqual({ lo: 32, hi: 33 });
    expect(bandOf("helmet5", "criticalDamages", 93)).toEqual({
      lo: 91,
      hi: 94,
    });
    expect(bandOf("chest5", "armor", 46)).toEqual({ lo: 45, hi: 47 });
    expect(bandOf("chest5", "armor", 47)).toEqual({ lo: 45, hi: 47 });
    expect(bandOf("gloves5", "precision", 34)).toEqual({ lo: 33, hi: 34 });
    expect(bandOf("boots5", "dodge", 38)).toEqual({ lo: 37, hi: 38 });
    expect(bandOf("jet", "attack", 300)).toEqual({ lo: 285, hi: 300 });
    expect(bandOf("boots5", "dodge", 41)).toBeNull();
    expect(bandOf("boots5", "dodge", "x")).toBeNull();
    expect(bandOf("boots5", "armor", 38)).toBeNull();
    expect(bandOf("hat", "dodge", 1)).toBeNull();
  });
  it("places a roll in its range from 0 to 1", () => {
    expect(rollPosition("jet", "attack", 221)).toBe(0);
    expect(rollPosition("jet", "attack", 300)).toBe(1);
    expect(rollPosition("tank", "criticalChance", 32)).toBeCloseTo(6 / 9, 6);
    expect(rollPosition("tank", "criticalChance", 36)).toBeNull();
  });
});
