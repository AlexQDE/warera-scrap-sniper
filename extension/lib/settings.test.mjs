import { describe, it, expect } from "vitest";
import { DEFAULTS, SELL_FROM, preferences } from "./settings.mjs";
const prefs = preferences;

describe("craft desk preferences", () => {
  it("defaults the desk on, compact, batch 1, 20% target, no tax set and no recipes", () => {
    const p = prefs({});
    expect(p).toMatchObject({
      craft: true,
      craftCollapsed: true,
      craftBatch: 1,
      craftTargetPct: 20,
      taxPct: null,
      craftRecipes: {},
    });
  });
  it("clamps the numbers, keeps a decimal tax rate, and validates recipes by code", () => {
    const p = prefs({
      craft: false,
      craftCollapsed: false,
      craftBatch: 5000,
      craftTargetPct: -80,
      taxPct: "2.5",
      craftRecipes: {
        boots5: { scraps: 10, steel: 2 },
        nope: { scraps: 1 },
        jet: { scraps: -1 },
      },
    });
    expect(p).toMatchObject({
      craft: false,
      craftCollapsed: false,
      craftBatch: 1000,
      craftTargetPct: -50,
      taxPct: 2.5,
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    expect(prefs({ taxPct: "" }).taxPct).toBeNull();
    expect(prefs({ taxPct: 250 }).taxPct).toBe(100);
    expect(prefs({ taxPct: "x" }).taxPct).toBeNull();
  });
});
describe("preferences", () => {
  it("defaults the drop policy to selling from epic upward", () => {
    expect(DEFAULTS.sellFrom).toBe("epic");
    expect(preferences().sellFrom).toBe("epic");
    expect(SELL_FROM).toEqual([
      "never",
      "common",
      "uncommon",
      "rare",
      "epic",
      "legendary",
      "mythic",
    ]);
  });
  it("keeps a valid policy and rejects anything else", () => {
    expect(preferences({ sellFrom: "never" }).sellFrom).toBe("never");
    expect(preferences({ sellFrom: "mythic" }).sellFrom).toBe("mythic");
    expect(preferences({ sellFrom: "purple" }).sellFrom).toBe("epic");
    expect(preferences({ sellFrom: 3 }).sellFrom).toBe("epic");
    expect(preferences({ sellFrom: null }).sellFrom).toBe("epic");
  });
  it("still clamps the numbers and keeps the toggles", () => {
    const p = preferences({
      minMarginPct: 999,
      intervalSec: 1,
      roundTrip: true,
    });
    expect(p.minMarginPct).toBe(500);
    expect(p.intervalSec).toBe(10);
    expect(p.roundTrip).toBe(true);
    expect(p.cases).toBe(true);
  });
});
