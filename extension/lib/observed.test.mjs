import { describe, it, expect } from "vitest";
import {
  averageOn,
  replayCrafts,
  rollValue,
  craftsSummary,
  MIN_ROLL_SAMPLE,
} from "./observed.mjs";

// Rows as the feed printed them for one account on 2026-10-05 (ids shortened).
const ME = "697b55e4bcecf3b37667e0d1";
const crafts = [
  {
    id: "a3cb5c",
    code: "tank",
    skills: { attack: 159, criticalChance: 32 },
    at: "2026-10-05T09:08:03.000Z",
    scraps: 486,
  },
  {
    id: "b06b3c",
    code: "boots5",
    skills: { dodge: 38 },
    at: "2026-10-05T09:08:01.000Z",
    scraps: 486,
  },
  {
    id: "d664c5",
    code: "chest5",
    skills: { armor: 46 },
    at: "2026-10-05T09:07:58.000Z",
    scraps: 486,
  },
  {
    id: "31f44d",
    code: "chest1",
    skills: { armor: 3 },
    at: "2026-10-05T05:35:57.000Z",
    scraps: 6,
  },
  {
    id: "old001",
    code: "gloves5",
    skills: { precision: 34 },
    at: "2026-10-01T17:14:27.000Z",
    scraps: 486,
  },
];
// The day's averages from itemTrading.getItemTrading: scraps 0.24778, steel 1.78976 on 2026-10-05.
const averages = {
  scraps: { "2026-10-04": 0.24964, "2026-10-05": 0.247778 },
  steel: { "2026-10-04": 1.78, "2026-10-05": 1.789756 },
};
const sales = [
  {
    itemId: "d664c5",
    code: "chest5",
    at: "2026-10-05T10:00:00.000Z",
    money: 129.396,
    seller: ME,
    buyer: "someone",
  },
  {
    itemId: "b06b3c",
    code: "boots5",
    at: "2026-10-05T10:05:00.000Z",
    money: 1,
    seller: "someone-else",
    buyer: ME,
  }, // a buy, not a sale of ours
];
const dismantles = [
  {
    itemId: "31f44d",
    code: "chest1",
    at: "2026-10-05T05:40:00.000Z",
    scraps: 6,
  },
];

describe("averageOn", () => {
  it("takes the day's average, else the latest earlier day, else nothing", () => {
    expect(averageOn(averages, "scraps", "2026-10-05")).toEqual({
      value: 0.247778,
      day: "2026-10-05",
    });
    expect(averageOn(averages, "steel", "2026-10-07")).toEqual({
      value: 1.789756,
      day: "2026-10-05",
    });
    expect(averageOn(averages, "steel", "2026-10-01")).toEqual({
      value: null,
      day: null,
    });
    expect(averageOn(null, "scraps", "2026-10-05")).toEqual({
      value: null,
      day: null,
    });
  });
});

describe("replayCrafts", () => {
  it("costs a craft at the recipe and the craft day's averages with the random steel fee, and joins its fate by item id", () => {
    const entries = replayCrafts({
      crafts,
      sales,
      dismantles,
      me: ME,
      averages,
    });
    const tank = entries.find((e) => e.id === "a3cb5c");
    // 486 × 0.247778 + 16 × 1.789756 = 120.420 + 28.636 = 149.056 g, the ledger site's 1,192.46 / 8
    expect(tank).toMatchObject({
      code: "tank",
      rarity: "legendary",
      tier: 5,
      slot: "weapon",
      stat: "criticalChance",
      day: "2026-10-05",
      scraps: 486,
      steel: 16,
      scrapPrice: 0.247778,
      steelPrice: 1.789756,
      priceDay: "2026-10-05",
      fate: "held",
      proceeds: null,
    });
    expect(tank.cost).toBeCloseTo(149.056, 3);
    const chest = entries.find((e) => e.id === "d664c5");
    expect(chest).toMatchObject({
      fate: "sold",
      proceeds: 129.396,
      proceedsBasis: "sold on the market",
      goneAt: "2026-10-05T10:00:00.000Z",
    });
    // our buy of someone else's boots is not a sale of our craft
    expect(entries.find((e) => e.id === "b06b3c").fate).toBe("held");
    const common = entries.find((e) => e.id === "31f44d");
    expect(common).toMatchObject({ fate: "scrapped", rarity: "common" });
    expect(common.cost).toBeCloseTo(6 * 0.247778 + 1 * 1.789756, 6);
    expect(common.proceeds).toBeCloseTo(6 * 0.247778, 6);
    expect(common.proceedsBasis).toContain("6 scraps back");
    // a craft older than the averages table has no cost, never a guess
    const old = entries.find((e) => e.id === "old001");
    expect(old).toMatchObject({ cost: null, scrapPrice: null, fate: "held" });
  });
  it("doubles the steel when the player says they choose the slot", () => {
    const [tank] = replayCrafts({
      crafts: crafts.slice(0, 1),
      me: ME,
      averages,
      steelMode: "chosen",
    });
    expect(tank.steel).toBe(32);
    expect(tank.cost).toBeCloseTo(486 * 0.247778 + 32 * 1.789756, 3);
  });
});

describe("rollValue", () => {
  const fill = (price, skills) => ({ price, skills });
  it("prices the exact roll with five fills, else its band, else the item, and says which", () => {
    const exact = Array.from({ length: 5 }, (_, i) =>
      fill(160 + i, { attack: 150, criticalChance: 32 }),
    );
    const band = Array.from({ length: 5 }, (_, i) =>
      fill(170 + i, { attack: 150, criticalChance: 33 }),
    );
    const others = Array.from({ length: 5 }, (_, i) =>
      fill(100 + i, { attack: 150, criticalChance: 27 }),
    );
    const skills = { attack: 159, criticalChance: 32 };
    expect(rollValue("tank", skills, [...exact, ...band, ...others])).toEqual({
      value: 162,
      level: "roll",
      n: 5,
      stat: "criticalChance",
      roll: 32,
      band: null,
    });
    expect(
      rollValue("tank", skills, [...exact.slice(1), ...band, ...others]),
    ).toEqual({
      // 161–164 of crit 32 and 170–174 of crit 33: nine in the 32–33 band, the fifth is 170
      value: 170,
      level: "band",
      n: 9,
      stat: "criticalChance",
      roll: 32,
      band: { lo: 32, hi: 33 },
    });
    expect(rollValue("tank", skills, [...exact.slice(1), ...others])).toEqual({
      value: 104, // 100–104 and 161–164: nine fills of the item, the fifth is 104
      level: "item",
      n: 9,
      stat: "criticalChance",
      roll: 32,
      band: null,
    });
    expect(rollValue("tank", skills, exact.slice(0, 4))).toMatchObject({
      value: null,
      level: null,
      n: 4,
    });
    expect(MIN_ROLL_SAMPLE).toBe(5);
  });
  it("counts fills without a stat (an older cache) at the item level only", () => {
    const bare = Array.from({ length: 6 }, (_, i) => fill(120 + i));
    expect(rollValue("boots5", { dodge: 38 }, bare)).toMatchObject({
      value: 122.5,
      level: "item",
      n: 6,
    });
    expect(rollValue("boots5", null, bare)).toMatchObject({
      level: "item",
      roll: null,
    });
  });
});

describe("craftsSummary", () => {
  it("counts epic and up, prices held pieces, realizes gone ones, and keeps lower tiers out of the sums", () => {
    const entries = replayCrafts({
      crafts,
      sales,
      dismantles,
      me: ME,
      averages,
    });
    const values = { a3cb5c: 161, b06b3c: 187.25 };
    const sum = craftsSummary(entries, {
      from: "2026-10-05",
      to: "2026-10-05",
      valueOf: (e) => ({ value: values[e.id] ?? null }),
    });
    expect(sum).toMatchObject({
      crafted: 4,
      counted: 3,
      below: 1,
      held: 2,
      sold: 1,
      scrapped: 0,
      covered: 2,
      costKnown: true,
      goneKnown: 1,
      proceeds: 129.396,
    });
    expect(sum.cost).toBeCloseTo(3 * 149.056, 2);
    expect(sum.heldCost).toBeCloseTo(2 * 149.056, 2);
    expect(sum.atMarket).toBeCloseTo(348.25, 6);
    expect(sum.unrealized).toBeCloseTo(348.25 - 2 * 149.056, 2);
    expect(sum.realized).toBeCloseTo(129.396 - 149.056, 2);
    expect(sum.realizedPct).toBeCloseTo((129.396 - 149.056) / 149.056, 4);
    // a held piece without a price leaves the unrealized figure unknown, never partial
    const partial = craftsSummary(entries, {
      from: "2026-10-05",
      to: "2026-10-05",
      valueOf: (e) => ({ value: e.id === "a3cb5c" ? 161 : null }),
    });
    expect(partial.covered).toBe(1);
    expect(partial.unrealized).toBeNull();
    expect(partial.atMarket).toBe(161);
    // the window: the older craft is out of today, in a week
    expect(
      craftsSummary(entries, {
        from: "2026-09-29",
        to: "2026-10-05",
        valueOf: () => null,
      }).crafted,
    ).toBe(5);
  });
});
