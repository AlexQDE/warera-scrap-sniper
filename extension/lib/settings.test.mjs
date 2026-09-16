import { describe, it, expect } from "vitest";
import { DEFAULTS, SELL_FROM, preferences } from "./settings.mjs";

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
