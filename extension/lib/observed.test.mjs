import { describe, it, expect } from "vitest";
import {
  averageOn,
  replayPieces,
  ledgerSummary,
  dayOf,
  localDayOf,
} from "./observed.mjs";

// Rows as the feed prints them for one account (ids shortened).
const ME = "697b55e4bcecf3b37667e0d1";
const OTHER = "69b4b8113af735a990a8070e";
const crafts = [
  {
    txId: "t1",
    id: "a3cb5c",
    code: "tank",
    skills: { attack: 159, criticalChance: 32 },
    at: "2026-10-05T09:08:03.000Z",
    scraps: 486,
  },
  {
    txId: "t2",
    id: "b06b3c",
    code: "boots5",
    skills: { dodge: 38 },
    at: "2026-10-05T09:08:01.000Z",
    scraps: 486,
  },
  {
    txId: "t3",
    id: "d664c5",
    code: "chest5",
    skills: { armor: 46 },
    at: "2026-10-05T09:07:58.000Z",
    scraps: 486,
  },
  {
    txId: "t4",
    id: "31f44d",
    code: "chest1",
    skills: { armor: 3 },
    at: "2026-10-05T05:35:57.000Z",
    scraps: 6,
  },
];
// The day's averages from itemTrading.getItemTrading: scraps 0.247778, steel 1.789756 on 2026-10-05.
const averages = {
  scraps: { "2026-10-04": 0.24964, "2026-10-05": 0.247778 },
  steel: { "2026-10-04": 1.78, "2026-10-05": 1.789756 },
};
const sales = [
  // the chest sold by me
  {
    txId: "s1",
    itemId: "d664c5",
    code: "chest5",
    skills: { armor: 46 },
    at: "2026-10-05T10:00:00.000Z",
    money: 129.396,
    seller: ME,
    buyer: OTHER,
    listedAt: "2026-10-05T09:30:00.000Z",
  },
  // a gun bought by me, then sold by me the next day
  {
    txId: "s2",
    itemId: "g00001",
    code: "gun",
    skills: { attack: 54, criticalChance: 8 },
    at: "2026-10-05T11:00:00.000Z",
    money: 4.413,
    seller: OTHER,
    buyer: ME,
    listedAt: "2026-10-05T10:00:00.000Z",
  },
  {
    txId: "s3",
    itemId: "g00001",
    code: "gun",
    skills: { attack: 54, criticalChance: 8 },
    at: "2026-10-06T08:00:00.000Z",
    money: 6.1,
    seller: ME,
    buyer: OTHER,
    listedAt: "2026-10-05T12:00:00.000Z",
  },
  // a sale by me of a piece the store never saw acquired
  {
    txId: "s4",
    itemId: "old123",
    code: "helmet4",
    skills: { criticalDamages: 80 },
    at: "2026-10-06T09:00:00.000Z",
    money: 40,
    seller: ME,
    buyer: OTHER,
    listedAt: null,
  },
];
const dismantles = [
  {
    txId: "d1",
    itemId: "31f44d",
    code: "chest1",
    skills: { armor: 3 },
    at: "2026-10-05T06:00:00.000Z",
    scraps: 6,
  },
];
const utc = (iso) => dayOf(iso);

describe("averageOn", () => {
  it("takes the day's average, else the latest earlier day, else nothing", () => {
    expect(averageOn(averages, "scraps", "2026-10-05")).toEqual({
      value: 0.247778,
      day: "2026-10-05",
    });
    expect(averageOn(averages, "steel", "2026-10-06")).toEqual({
      value: 1.789756,
      day: "2026-10-05",
    });
    expect(averageOn(averages, "scraps", "2026-10-01")).toEqual({
      value: null,
      day: null,
    });
    expect(averageOn(null, "scraps", "2026-10-05")).toEqual({
      value: null,
      day: null,
    });
  });
  it("names days in UTC for the averages and in local time for the ledger", () => {
    expect(dayOf("2026-10-05T23:30:00.000Z")).toBe("2026-10-05");
    expect(localDayOf("2026-10-05T12:00:00.000Z")).toMatch(/^2026-10-0[56]$/);
    expect(localDayOf("nope")).toBe("");
  });
});

describe("replayPieces", () => {
  const pieces = replayPieces({ crafts, sales, dismantles, me: ME, averages });
  const by = (id) => pieces.find((p) => p.id === id);
  it("costs a craft at the recipe and the craft day's averages with the random steel fee", () => {
    const tank = by("a3cb5c");
    // 486 × 0.247778 + 16 × 1.789756 = 149.056
    expect(tank).toMatchObject({
      source: "crafted",
      rarity: "legendary",
      slot: "weapon",
      stat: "criticalChance",
      scraps: 486,
      steel: 16,
      fate: "held",
      priceDay: "2026-10-05",
    });
    expect(tank.cost).toBeCloseTo(486 * 0.247778 + 16 * 1.789756, 6);
    expect(tank.costBasis).toContain("the day's averages");
    const chosen = replayPieces({
      crafts,
      sales: [],
      dismantles: [],
      me: ME,
      averages,
      steelMode: "chosen",
    });
    expect(chosen.find((p) => p.id === "a3cb5c").cost).toBeCloseTo(
      486 * 0.247778 + 32 * 1.789756,
      6,
    );
  });
  it("joins a craft's sale by item id with the listing wait, and a dismantle at the day's scrap average", () => {
    expect(by("d664c5")).toMatchObject({
      fate: "sold",
      proceeds: 129.396,
      goneAt: "2026-10-05T10:00:00.000Z",
      sellsHours: 0.5,
      proceedsBasis: "sold on the market",
    });
    expect(by("31f44d")).toMatchObject({
      fate: "scrapped",
      proceeds: 6 * 0.247778,
      goneAt: "2026-10-05T06:00:00.000Z",
    });
    expect(by("31f44d").proceedsBasis).toContain("6 scraps back");
  });
  it("takes a buy as an acquisition at its price, and a later sale of the same item as its fate", () => {
    const gun = by("g00001");
    expect(gun).toMatchObject({
      source: "bought",
      cost: 4.413,
      costBasis: "bought on the market",
      at: "2026-10-05T11:00:00.000Z",
      fate: "sold",
      proceeds: 6.1,
      goneAt: "2026-10-06T08:00:00.000Z",
      sellsHours: 20,
      rarity: "uncommon",
    });
  });
  it("keeps a sale of a piece the store never saw acquired, with no cost, so its proceeds still count", () => {
    expect(by("old123")).toMatchObject({
      source: "unknown",
      at: null,
      cost: null,
      fate: "sold",
      proceeds: 40,
      code: "helmet4",
      costBasis: "got before the feed on record",
    });
    expect(pieces).toHaveLength(6);
  });
  it("attaches a fate to the latest acquisition before it, so a piece bought twice is two pieces", () => {
    const twice = replayPieces({
      crafts: [],
      sales: [
        {
          txId: "b1",
          itemId: "x",
          code: "gun",
          skills: null,
          at: "2026-10-05T10:00:00.000Z",
          money: 4,
          seller: OTHER,
          buyer: ME,
        },
        {
          txId: "x1",
          itemId: "x",
          code: "gun",
          skills: null,
          at: "2026-10-05T11:00:00.000Z",
          money: 5,
          seller: ME,
          buyer: OTHER,
        },
        {
          txId: "b2",
          itemId: "x",
          code: "gun",
          skills: null,
          at: "2026-10-05T12:00:00.000Z",
          money: 4.5,
          seller: OTHER,
          buyer: ME,
        },
      ],
      dismantles: [],
      me: ME,
      averages: {},
    });
    expect(twice.map((p) => [p.cost, p.fate, p.proceeds])).toEqual([
      [4, "sold", 5],
      [4.5, "held", null],
    ]);
  });
});

describe("ledgerSummary", () => {
  const pieces = replayPieces({ crafts, sales, dismantles, me: ME, averages });
  const valueOf = (p) => (p.id === "a3cb5c" ? { value: 161 } : { value: null });
  it("sums the day by what was sold or scrapped in it, what was crafted and bought, and what is held", () => {
    const d5 = ledgerSummary(pieces, {
      from: "2026-10-05",
      to: "2026-10-05",
      dayOf: utc,
      valueOf,
    });
    expect(d5.gone).toMatchObject({
      n: 2,
      sold: 1,
      scrapped: 1,
      known: 2,
      unknownCost: 0,
    });
    expect(d5.gone.proceeds).toBeCloseTo(129.396 + 6 * 0.247778, 6);
    // the chest: 129.396 − 149.056; the common chest: 1.487 back − (6 × 0.247778 + 1 × 1.789756)
    expect(d5.gone.realized).toBeCloseTo(
      129.396 -
        (486 * 0.247778 + 16 * 1.789756) +
        6 * 0.247778 -
        (6 * 0.247778 + 1.789756),
      5,
    );
    expect(d5.crafted).toMatchObject({
      n: 4,
      costKnown: 4,
      sold: 1,
      scrapped: 1,
      held: 2,
      soldProceeds: 129.396,
    });
    expect(d5.bought).toMatchObject({
      n: 1,
      cost: 4.413,
      sold: 1,
      soldProceeds: 6.1,
      held: 0,
    });
    expect(d5.held).toMatchObject({
      n: 2,
      costKnown: 2,
      covered: 1,
      value: 161,
      unrealized: null,
    });
    const d6 = ledgerSummary(pieces, {
      from: "2026-10-06",
      to: "2026-10-06",
      dayOf: utc,
      valueOf,
    });
    expect(d6.gone).toMatchObject({ n: 2, sold: 2, known: 1, unknownCost: 1 });
    expect(d6.gone.proceeds).toBeCloseTo(46.1, 6);
    expect(d6.gone.realized).toBeCloseTo(6.1 - 4.413, 6); // the helmet's cost is unknown: its proceeds count, its result does not
    expect(d6.crafted.n).toBe(0);
    const week = ledgerSummary(pieces, {
      from: "2026-10-01",
      to: "2026-10-07",
      dayOf: utc,
      valueOf: () => ({ value: 100 }),
    });
    expect(week.gone.n).toBe(4);
    expect(week.held).toMatchObject({ n: 2, covered: 2, value: 200 });
    expect(week.held.unrealized).toBeCloseTo(
      200 - 2 * (486 * 0.247778 + 16 * 1.789756),
      5,
    );
  });
});
