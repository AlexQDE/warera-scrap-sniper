import { describe, it, expect } from "vitest";
import { DEFAULTS, SELL_FROM, PANELS, preferences } from "./settings.mjs";

describe("preferences", () => {
  it("defaults to the bar alone, both market modules on, no player id set", () => {
    expect(preferences({})).toMatchObject({
      minMarginPct: 0,
      flipPct: 10,
      intervalSec: 30,
      panel: "none",
      equipment: true,
      craft: true,
      cases: true,
      travel: true,
      picker: true,
      userId: null,
      craftSteelMode: "random",
      sellFrom: "epic",
    });
    expect(PANELS).toEqual(["none", "market", "craft", "ledger"]);
  });
  it("keeps a known panel and falls back to none for anything else, including the old collapsed flags", () => {
    expect(preferences({ panel: "ledger" }).panel).toBe("ledger");
    expect(preferences({ panel: "craft" }).panel).toBe("craft");
    expect(preferences({ panel: "desk" }).panel).toBe("none");
    expect(
      preferences({ collapsed: false, craftCollapsed: false }),
    ).not.toHaveProperty("collapsed");
    expect(preferences({ craftCollapsed: false }).panel).toBe("none");
  });
  it("keeps a 24-hex player id and the chosen-slot mode, and drops anything else", () => {
    expect(
      preferences({
        userId: " 697b55e4bcecf3b37667e0d1 ",
        craftSteelMode: "chosen",
      }),
    ).toMatchObject({
      userId: "697b55e4bcecf3b37667e0d1",
      craftSteelMode: "chosen",
    });
    expect(
      preferences({ userId: "../settings", craftSteelMode: "x" }),
    ).toMatchObject({ userId: null, craftSteelMode: "random" });
    expect(preferences({ userId: 42 }).userId).toBeNull();
  });
  it("clamps the thresholds and the interval to whole numbers in range", () => {
    const p = preferences({
      minMarginPct: 999,
      flipPct: -80,
      intervalSec: 1,
      roundTrip: true,
    });
    expect(p.minMarginPct).toBe(500);
    expect(p.flipPct).toBe(-50);
    expect(p.intervalSec).toBe(10);
    expect(p.roundTrip).toBe(true);
    expect(preferences({ flipPct: "12.6" }).flipPct).toBe(13);
    expect(preferences({ flipPct: "" }).flipPct).toBe(10);
    expect(preferences({ flipPct: "x" }).flipPct).toBe(10);
    expect(preferences({ flipPct: 0 }).flipPct).toBe(0);
  });
  it("defaults the drop policy to selling from epic upward and rejects unknown policies", () => {
    expect(DEFAULTS.sellFrom).toBe("epic");
    expect(SELL_FROM).toEqual([
      "never",
      "common",
      "uncommon",
      "rare",
      "epic",
      "legendary",
      "mythic",
    ]);
    expect(preferences({ sellFrom: "never" }).sellFrom).toBe("never");
    expect(preferences({ sellFrom: "mythic" }).sellFrom).toBe("mythic");
    expect(preferences({ sellFrom: "purple" }).sellFrom).toBe("epic");
    expect(preferences({ sellFrom: 3 }).sellFrom).toBe("epic");
    expect(preferences({ sellFrom: null }).sellFrom).toBe("epic");
  });
  it("never copies arbitrary storage fields across", () => {
    const p = preferences({ apiKey: "secret", revision: 7, foo: 1 });
    expect(p).not.toHaveProperty("apiKey");
    expect(p).not.toHaveProperty("revision");
    expect(p).not.toHaveProperty("foo");
  });
});
