import { describe, it, expect } from "vitest";
import {
  makePricer,
  replayHistory,
  outcome,
  windowView,
  dayOf,
  localDayOf,
  memoDay,
} from "./observed.mjs";

// Compact rows as the history store keeps them (api.reduceRow), ids shortened.
const A = (h) =>
  new Date(Date.parse("2026-10-05T12:00:00Z") + h * 3600e3).toISOString();
const averages = {
  scraps: { "2026-10-04": 0.25, "2026-10-05": 0.2 },
  steel: { "2026-10-05": 1.5 },
  case1: { "2026-10-05": 3.8 },
  woodenCase: { "2026-10-05": 6 },
  iron: { "2026-10-05": 0.1 },
};
const rows = [
  // a legendary tank crafted, held
  {
    x: "t1",
    y: "craftItem",
    a: A(0),
    c: "scraps",
    q: 486,
    i: "tank1",
    ic: "tank",
    k: { attack: 159, criticalChance: 32 },
  },
  // a legendary chest crafted, then sold by me
  {
    x: "t2",
    y: "craftItem",
    a: A(0.1),
    c: "scraps",
    q: 486,
    i: "chest1",
    ic: "chest5",
    k: { armor: 46 },
  },
  {
    x: "s1",
    y: "itemMarket",
    a: A(1),
    c: "chest5",
    q: 1,
    m: 129.4,
    d: -1,
    i: "chest1",
    ic: "chest5",
    k: { armor: 46 },
    l: A(0.5),
  },
  // a case opened: a knife, then scrapped
  {
    x: "o1",
    y: "openCase",
    a: A(2),
    c: "case1",
    q: 1,
    i: "knife1",
    ic: "knife",
    k: { attack: 37, criticalChance: 4 },
  },
  {
    x: "d1",
    y: "dismantleItem",
    a: A(3),
    c: "scraps",
    q: 6,
    i: "knife1",
    ic: "knife",
    k: { attack: 37, criticalChance: 4 },
  },
  // a case opened: gloves, held
  {
    x: "o2",
    y: "openCase",
    a: A(2.1),
    c: "case1",
    q: 1,
    i: "glv1",
    ic: "gloves1",
    k: { precision: 5 },
  },
  // a wooden case: resources, no piece
  { x: "o3", y: "openCase", a: A(2.2), c: "iron", q: 50 },
  // a gun bought, then sold by me
  {
    x: "b1",
    y: "itemMarket",
    a: A(4),
    c: "gun",
    q: 1,
    m: 4,
    d: 1,
    i: "gun1",
    ic: "gun",
    k: { attack: 54, criticalChance: 8 },
  },
  {
    x: "b2",
    y: "itemMarket",
    a: A(5),
    c: "gun",
    q: 1,
    m: 6,
    d: -1,
    i: "gun1",
    ic: "gun",
    k: { attack: 54, criticalChance: 8 },
    l: A(4.5),
  },
  // battle loot, held
  {
    x: "l1",
    y: "battleLoot",
    a: A(6),
    c: "helmet2",
    q: 1,
    i: "hlm1",
    ic: "helmet2",
    k: { criticalDamages: 18 },
  },
  // a sale of a piece got before the history
  {
    x: "s9",
    y: "itemMarket",
    a: A(7),
    c: "boots3",
    q: 1,
    m: 20,
    d: -1,
    i: "old1",
    ic: "boots3",
    k: { dodge: 12 },
  },
  // resource trades: cases bought, iron sold
  { x: "r1", y: "trading", a: A(1), c: "case1", q: 3, m: 11.4, d: 1 },
  { x: "r2", y: "trading", a: A(1), c: "iron", q: 1000, m: 93, d: -1 },
];

describe("days and prices", () => {
  it("names days in UTC for the averages and local for the ledger", () => {
    expect(dayOf("2026-10-05T23:30:00.000Z")).toBe("2026-10-05");
    expect(localDayOf("2026-10-05T12:00:00.000Z")).toMatch(/^2026-10-0[56]$/);
    expect(localDayOf("nope")).toBe("");
  });
  it("prices a day at the game's average, else the player's own trades that day, else the nearest day on record, flagged", () => {
    const price = makePricer(averages, [
      {
        x: "r",
        y: "trading",
        a: "2026-09-01T10:00:00.000Z",
        c: "steel",
        q: 10,
        m: 18,
        d: 1,
      },
    ]);
    expect(price("scraps", "2026-10-05")).toEqual({
      value: 0.2,
      approx: false,
    });
    expect(price("steel", "2026-09-01")).toEqual({ value: 1.8, approx: false }); // the player's own trade
    expect(price("scraps", "2026-09-20")).toEqual({
      value: 0.25,
      approx: true,
    }); // before the table: its first day
    expect(price("scraps", "2026-10-09")).toEqual({ value: 0.2, approx: true }); // after: the latest earlier day
    expect(price("nothing", "2026-10-05")).toEqual({
      value: null,
      approx: false,
    });
  });
});

describe("replayHistory", () => {
  const h = replayHistory(rows, { averages });
  const by = (id) => h.pieces.find((p) => p.id === id);
  it("costs a craft at the recipe and the day's prices, random steel unless chosen", () => {
    expect(by("tank1")).toMatchObject({
      source: "crafted",
      rarity: "legendary",
      fate: "held",
      approx: false,
    });
    expect(by("tank1").cost).toBeCloseTo(486 * 0.2 + 16 * 1.5, 6);
    const chosen = replayHistory(rows, { averages, steelMode: "chosen" });
    expect(chosen.pieces.find((p) => p.id === "tank1").cost).toBeCloseTo(
      486 * 0.2 + 32 * 1.5,
      6,
    );
    expect(by("chest1")).toMatchObject({
      fate: "sold",
      proceeds: 129.4,
      sellsHours: 0.5,
    });
  });
  it("takes a case opening as an acquisition at the case's price that day, and its dismantle at that day's scrap price", () => {
    expect(by("knife1")).toMatchObject({
      source: "opened",
      via: "case1",
      cost: 3.8,
      fate: "scrapped",
    });
    expect(by("knife1").proceeds).toBeCloseTo(6 * 0.2, 6);
    expect(by("glv1")).toMatchObject({ source: "opened", fate: "held" });
    expect(h.wooden).toEqual([
      { at: A(2.2), code: "iron", q: 50, value: 5, cost: 6, approx: false },
    ]);
  });
  it("takes a buy at its price and loot at nothing; a sale with no acquisition on record has no cost", () => {
    expect(by("gun1")).toMatchObject({
      source: "bought",
      cost: 4,
      fate: "sold",
      proceeds: 6,
      sellsHours: 0.5,
    });
    expect(by("hlm1")).toMatchObject({
      source: "looted",
      cost: 0,
      fate: "held",
    });
    expect(by("old1")).toMatchObject({
      source: "unknown",
      at: null,
      cost: null,
      fate: "sold",
      proceeds: 20,
    });
    expect(h.pieces).toHaveLength(7);
    expect(h.trades).toEqual({
      case1: { qty: 3, spent: 11.4, sold: 0, earned: 0 },
      iron: { qty: 0, spent: 0, sold: 1000, earned: 93 },
    });
  });
  it("attaches a fate to the latest acquisition before it, so a piece bought twice is two pieces", () => {
    const twice = replayHistory(
      [
        {
          x: "1",
          y: "itemMarket",
          a: A(0),
          c: "gun",
          m: 4,
          d: 1,
          i: "x",
          ic: "gun",
        },
        {
          x: "2",
          y: "itemMarket",
          a: A(1),
          c: "gun",
          m: 5,
          d: -1,
          i: "x",
          ic: "gun",
        },
        {
          x: "3",
          y: "itemMarket",
          a: A(2),
          c: "gun",
          m: 4.5,
          d: 1,
          i: "x",
          ic: "gun",
        },
      ],
      {},
    );
    expect(twice.pieces.map((p) => [p.cost, p.fate, p.proceeds])).toEqual([
      [4, "sold", 5],
      [4.5, "held", null],
    ]);
  });
});

describe("tying a sale to its piece when the sale gave it a new id", () => {
  const craft = (n, at, k) => ({
    x: `c${n}`,
    y: "craftItem",
    a: at,
    c: "scraps",
    q: 162,
    i: `p${n}`,
    ic: "boots4",
    k,
    la: at,
  });
  it("ties by the same code and stats got at the time the sale row says, the closest of identical pieces", () => {
    const h = replayHistory(
      [
        craft(1, A(0), { dodge: 22 }),
        craft(2, new Date(Date.parse(A(0)) + 600).toISOString(), { dodge: 22 }),
        craft(3, A(0.01), { dodge: 25 }),
        // sold under a new id; the seller got the piece 0.6 s after the first craft: the second one
        {
          x: "s1",
          y: "itemMarket",
          a: A(1),
          c: "boots4",
          m: 30,
          d: -1,
          i: "new1",
          ic: "boots4",
          k: { dodge: 22 },
          la: new Date(Date.parse(A(0)) + 610).toISOString(),
        },
        // a relisted piece: its acquired-at moved to when it came back from the market; same code and stats got before
        {
          x: "s2",
          y: "itemMarket",
          a: A(2),
          c: "boots4",
          m: 31,
          d: -1,
          i: "new2",
          ic: "boots4",
          k: { dodge: 25 },
          la: A(1.5),
        },
      ],
      { averages },
    );
    const by = (id) => h.pieces.find((p) => p.id === id);
    expect(by("p2")).toMatchObject({ fate: "sold", proceeds: 30 });
    expect(by("p1")).toMatchObject({ fate: "held" });
    expect(by("p3")).toMatchObject({ fate: "sold", proceeds: 31 });
    expect(h.pieces.filter((p) => p.source === "unknown")).toHaveLength(0);
  });
});

describe("outcome and windowView", () => {
  const h = replayHistory(rows, { averages });
  const valueOf = (p) => ({ tank1: 161, glv1: 1, hlm1: 2 })[p.id] ?? null;
  it("sums what a set of pieces cost, brought and is worth held", () => {
    const o = outcome(
      h.pieces.filter((p) => p.source === "opened"),
      valueOf,
    );
    expect(o).toMatchObject({
      n: 2,
      sold: 0,
      scrapped: 1,
      held: 1,
      heldPriced: 1,
      realizedKnown: 1,
      estimatedKnown: 2,
    });
    expect(o.cost).toBeCloseTo(7.6, 6);
    expect(o.realized).toBeCloseTo(1.2 - 3.8, 6);
    expect(o.estimated).toBeCloseTo(1.2 - 3.8 + (1 - 3.8), 6);
  });
  it("splits a window by activity, per case and per crafted tier, and counts the window's money", () => {
    const day = (iso) => dayOf(iso);
    const v = windowView(h, {
      from: "2026-10-05",
      to: "2026-10-05",
      dayOf: day,
      valueOf,
    });
    expect(v.crafted).toMatchObject({ n: 2, sold: 1, held: 1 });
    expect(v.crafted.estimated).toBeCloseTo(
      129.4 + 161 - 2 * (486 * 0.2 + 16 * 1.5),
      6,
    );
    expect(v.opened.n).toBe(2);
    expect(v.bought).toMatchObject({ n: 1, sold: 1 });
    expect(v.bought.realized).toBeCloseTo(2, 6);
    expect(v.looted).toMatchObject({ n: 1, cost: 0, held: 1 });
    expect(Object.keys(v.cases)).toEqual(["case1"]);
    expect(v.tiers.legendary.n).toBe(2);
    expect(v.wooden).toEqual({ n: 1, value: 5, cost: 6 });
    // the window's money: chest, knife, gun, and the old boots (no cost on record)
    expect(v.money).toMatchObject({
      n: 4,
      sold: 3,
      scrapped: 1,
      known: 3,
      unknownCost: 1,
    });
    expect(v.money.proceeds).toBeCloseTo(129.4 + 1.2 + 6 + 20, 6);
    const empty = windowView(h, {
      from: "2026-10-06",
      to: "2026-10-06",
      dayOf: day,
      valueOf,
    });
    expect(empty.crafted.n).toBe(0);
    expect(empty.money.n).toBe(0);
  });
});

describe("gear worn in battle", () => {
  // A legendary tank crafted, worn down in battle, scrapped for a third of its
  // scraps; an epic sniper crafted and scrapped fresh (a reroll) for its whole
  // ladder; a legendary chest crafted and sold.
  const worn = [
    {
      x: "w1",
      y: "craftItem",
      a: A(0),
      c: "scraps",
      q: 486,
      i: "tankW",
      ic: "tank",
      k: { attack: 150, criticalChance: 30 },
    },
    {
      x: "w2",
      y: "dismantleItem",
      a: A(3),
      c: "scraps",
      q: 162,
      i: "tankW",
      ic: "tank",
      k: { attack: 150, criticalChance: 30 },
    },
    {
      x: "w3",
      y: "craftItem",
      a: A(0.2),
      c: "scraps",
      q: 162,
      i: "snpF",
      ic: "sniper",
      k: { attack: 103, criticalChance: 16 },
    },
    {
      x: "w4",
      y: "dismantleItem",
      a: A(0.3),
      c: "scraps",
      q: 162,
      i: "snpF",
      ic: "sniper",
      k: { attack: 103, criticalChance: 16 },
    },
    {
      x: "w5",
      y: "craftItem",
      a: A(0.4),
      c: "scraps",
      q: 486,
      i: "chestS",
      ic: "chest5",
      k: { armor: 46 },
    },
    {
      x: "w6",
      y: "itemMarket",
      a: A(1),
      c: "chest5",
      q: 1,
      m: 140,
      d: -1,
      i: "chestS",
      ic: "chest5",
      k: { armor: 46 },
    },
  ];
  const h = replayHistory(worn, { averages });
  const by = (id) => h.pieces.find((p) => p.id === id);
  const cost5 = 486 * 0.2 + 16 * 1.5;
  const cost4 = 162 * 0.2 + 8 * 1.5;
  it("marks a piece scrapped for fewer scraps than its tier's ladder as worn, a full return as not", () => {
    expect(by("tankW")).toMatchObject({ fate: "scrapped", worn: true });
    expect(by("snpF")).toMatchObject({ fate: "scrapped", worn: false });
    expect(by("chestS")).toMatchObject({ fate: "sold", worn: false });
  });
  it("leaves worn pieces out of a result when worn gear is not counted, and says how many", () => {
    const eco = outcome(h.pieces, () => null, { countWorn: false });
    expect(eco).toMatchObject({ n: 2, worn: 1, scrapped: 1, sold: 1 });
    expect(eco.cost).toBeCloseTo(cost4 + cost5, 6);
    expect(eco.realized).toBeCloseTo(162 * 0.2 - cost4 + (140 - cost5), 6);
    const war = outcome(h.pieces, () => null);
    expect(war).toMatchObject({ n: 3, worn: 1, scrapped: 2 });
    expect(war.realized).toBeCloseTo(eco.realized + (162 * 0.2 - cost5), 6);
  });
  it("keeps worn gear out of a window's tiers and money when not counted", () => {
    const view = (countWorn) =>
      windowView(h, {
        from: "2026-10-05",
        to: "2026-10-05",
        dayOf,
        valueOf: () => null,
        countWorn,
      });
    const eco = view(false);
    expect(eco.tiers.legendary).toMatchObject({ n: 1, worn: 1 });
    expect(eco.tiers.epic).toMatchObject({ n: 1, worn: 0 });
    expect(eco.crafted).toMatchObject({ n: 2, worn: 1 });
    expect(eco.money).toMatchObject({ n: 2, worn: 1 });
    const war = view(true);
    expect(war.tiers.legendary).toMatchObject({ n: 2, worn: 1 });
    expect(war.money).toMatchObject({ n: 3, worn: 1 });
  });
});

describe("memoDay", () => {
  it("names the same day as the function it wraps and reads each time once", () => {
    let calls = 0;
    const day = memoDay((iso) => {
      calls++;
      return dayOf(iso);
    });
    expect(day(A(0))).toBe("2026-10-05");
    expect(day(A(0))).toBe("2026-10-05");
    expect(day(null)).toBe("");
    expect(calls).toBe(1);
  });
});
