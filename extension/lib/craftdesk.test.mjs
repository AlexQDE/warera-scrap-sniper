// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createCraftDesk } from "./craftdesk.mjs";
import { DEFAULTS, preferences } from "./settings.mjs";
import { ALL_GEAR_CODES } from "./items.mjs";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const iso = (msAgo = 0) => new Date(NOW - msAgo).toISOString();
const book = (bid, ask, quantity = 1e6) => ({
  bid,
  ask,
  bidQty: quantity,
  askQty: quantity,
  bids: [{ price: bid, quantity }],
  asks: [{ price: ask, quantity }],
});
const fills = (code, prices, skills = null) =>
  prices.map((price, i) => ({
    price,
    at: iso((i + 1) * 3600e3),
    state: 100,
    code,
    skills,
  }));
const avgOf = (values) => ({
  at: iso(),
  values: {
    ...Object.fromEntries(ALL_GEAR_CODES.map((c) => [c, null])),
    ...values,
  },
  times: Object.fromEntries(Object.keys(values).map((c) => [c, iso()])),
});
let desk, settings, state, body, requestSales;
let clock = NOW;
const text = () => body.textContent;
const click = (selector) => {
  const b = body.querySelector(selector);
  if (!b) throw new Error(`no control ${selector}`);
  b.click();
};
const render = (section = "craft") => desk.render(body, state, section);

beforeEach(() => {
  clock = NOW;
  document.body.innerHTML = '<main><div id="body"></div></main>';
  body = document.getElementById("body");
  body.addEventListener("click", (e) => {
    if (desk.onClick(e))
      render(body.querySelector(".lens-desk")?.dataset.section);
  });
  settings = preferences({ ...DEFAULTS });
  requestSales = vi.fn();
  desk = createCraftDesk({
    settings: () => settings,
    requestSales,
    now: () => clock,
  });
  state = {
    settings,
    book: { at: iso(), ...book(0.2, 0.21) },
    cases: { at: iso(), books: { steel: book(1.5, 1.6) } },
    avg: avgOf({
      sniper: 60,
      helmet4: 30,
      chest4: 30,
      gloves4: 30,
      pants4: 30,
      boots4: 30,
      jet: 480,
    }),
    salesByCode: {},
    salesErrors: {},
    selectedCode: null,
    setup: null,
    busy: false,
  };
});
afterEach(() => {
  desk.clear();
  document.body.innerHTML = "";
});

describe("the craft board", () => {
  it("prices every tier at the asks and values it at the game's averages: random EV, best chosen slot, ROI", () => {
    render();
    expect(
      body.querySelectorAll(".lens-board tbody tr.lens-tier"),
    ).toHaveLength(6);
    const epic = body.querySelector('.lens-tier[data-rarity="epic"]');
    // 162 scraps × 0.21 + 8 steel × 1.6 = 46.82 at random; EV 0.3 × 60 + 0.7 × 30 = 39
    expect(epic.textContent).toContain("46.820");
    expect(epic.textContent).toContain("39.000");
    expect(epic.textContent).toContain("−17%");
    expect(epic.textContent).toContain("epic sniper");
    expect(epic.textContent).toContain("+1%"); // 60 against 162 × 0.21 + 16 × 1.6 = 59.62
    const mythic = body.querySelector('.lens-tier[data-rarity="mythic"]');
    expect(mythic.textContent).toContain("357.380"); // 1458 × 0.21 + 32 × 1.6
    expect(mythic.textContent).toContain("1/6 slots");
    expect(mythic.textContent).toContain("mythic jet");
    expect(text()).toContain("Best now: epic at random, ROI −17%");
    expect(text()).toContain("scraps 0.210 ask · 0.200 bid");
    expect(text()).toContain("steel 1.600 ask");
  });
  it("says no depth when the observed asks do not cover a craft, and waits for the averages", () => {
    state.book = { at: iso(), ...book(0.2, 0.21, 1000) };
    state.avg = null;
    render();
    const mythic = body.querySelector('.lens-tier[data-rarity="mythic"]');
    expect(mythic.textContent).toContain("no depth");
    expect(mythic.querySelector("[title]").title).toContain(
      "do not cover scraps",
    );
    const common = body.querySelector('.lens-tier[data-rarity="common"]');
    expect(common.textContent).toContain("2.860"); // 6 × 0.21 + 1 × 1.6
    expect(common.textContent).toContain("0/6 slots");
    expect(text()).toContain("values: the game's average per item · reading…");
    expect(text()).toContain("No tier can be valued yet");
  });
  it("opens a tier: its slots at the game's averages, the recipe, the reroll loss, the selected item's fills", () => {
    state.selectedCode = "sniper";
    state.salesByCode.sniper = {
      code: "sniper",
      at: iso(),
      complete: true,
      fills: fills("sniper", [55, 60, 65]),
    };
    render();
    expect(body.querySelector(".lens-tier-detail")).toBeNull();
    click('[data-action="desk-tier"][data-tier="4"]');
    const detail = body.querySelector(".lens-tier-detail");
    expect(detail).not.toBeNull();
    expect(detail.querySelectorAll(".lens-chip")).toHaveLength(6);
    expect(detail.textContent).toContain("epic sniper 60.000 30%");
    expect(detail.textContent).toContain("epic helmet 30.000 14%");
    expect(detail.textContent).toContain(
      "Recipe 162 scraps + 8 steel at random, 16 steel for a chosen slot (59.620 g)",
    );
    // 162 scraps back at the 0.2 bid = 32.4; the random craft cost 46.82, so a bad roll costs 14.42
    expect(detail.textContent).toContain("gives 32.400 g back at the bid");
    expect(detail.textContent).toContain("really costs 14.420 g");
    expect(detail.textContent).toContain(
      "epic sniper: 3 sales in 7 d · median 60.000 g · 55.000–65.000 (selected in the grid)",
    );
    expect(
      body
        .querySelector('[data-action="desk-tier"][data-tier="4"]')
        .getAttribute("aria-pressed"),
    ).toBe("true");
    click('[data-action="desk-tier"][data-tier="4"]');
    expect(body.querySelector(".lens-tier-detail")).toBeNull();
    state.selectedCode = "jet";
    click('[data-action="desk-tier"][data-tier="6"]');
    expect(body.querySelector(".lens-tier-detail").textContent).toContain(
      "mythic jet: reading its fills…",
    );
    state.selectedCode = null;
    render();
    expect(body.querySelector(".lens-tier-detail").textContent).toContain(
      "select an item of this tier in the grid",
    );
  });
});

describe("the ledger", () => {
  const ME = "697b55e4bcecf3b37667e0d1";
  const o = (over = {}) => ({
    n: 0,
    cost: 0,
    costUnknown: 0,
    approx: 0,
    sold: 0,
    scrapped: 0,
    proceeds: 0,
    held: 0,
    heldValue: 0,
    heldPriced: 0,
    realized: 0,
    realizedKnown: 0,
    estimated: 0,
    estimatedKnown: 0,
    ...over,
  });
  const win = (over = {}) => ({
    crafted: o(),
    opened: o(),
    bought: o(),
    looted: o(),
    cases: {},
    tiers: {},
    wooden: { n: 0, value: 0, cost: 0 },
    money: {
      n: 0,
      sold: 0,
      scrapped: 0,
      proceeds: 0,
      realized: 0,
      known: 0,
      unknownCost: 0,
    },
    ...over,
  });
  const view = () => ({
    meta: {
      userId: ME,
      username: "Johnny_Sins",
      done: true,
      count: 23906,
      oldestAt: "2026-01-29T12:51:13.453Z",
      at: iso(),
      rev: 4,
    },
    windows: {
      today: win({
        crafted: o({
          n: 2,
          cost: 298.112,
          sold: 1,
          proceeds: 129.396,
          held: 1,
          heldValue: 161,
          heldPriced: 1,
          realized: -19.66,
          realizedKnown: 1,
          estimated: -7.716,
          estimatedKnown: 2,
        }),
        opened: o({
          n: 10,
          cost: 38,
          scrapped: 9,
          proceeds: 10.8,
          held: 1,
          heldValue: 1.5,
          heldPriced: 1,
          realized: -23.4,
          realizedKnown: 9,
          estimated: -25.7,
          estimatedKnown: 10,
        }),
        cases: {
          case1: o({ n: 10, cost: 38, estimated: -25.7, estimatedKnown: 10 }),
        },
        tiers: {
          legendary: o({
            n: 2,
            cost: 298.112,
            estimated: -7.716,
            estimatedKnown: 2,
          }),
        },
        money: {
          n: 11,
          sold: 2,
          scrapped: 9,
          proceeds: 160.2,
          realized: -41.37,
          known: 10,
          unknownCost: 1,
        },
      }),
      week: win(),
      month: win(),
      all: win({
        opened: o({
          n: 8780,
          cost: 33000,
          estimated: -1200,
          estimatedKnown: 8780,
        }),
      }),
    },
    rows: [
      {
        id: "a",
        code: "tank",
        rarity: "legendary",
        skills: { attack: 159, criticalChance: 32 },
        source: "crafted",
        at: iso(3600e3),
        cost: 149.056,
        approx: false,
        fate: "held",
        proceeds: null,
        goneAt: null,
        sellsHours: null,
        value: { value: 161, label: "5 sales · atk 159 · crit 32% · 7 d" },
      },
      {
        id: "b",
        code: "chest5",
        rarity: "legendary",
        skills: { armor: 46 },
        source: "crafted",
        at: iso(3700e3),
        cost: 149.056,
        approx: false,
        fate: "sold",
        proceeds: 129.396,
        goneAt: iso(1800e3),
        sellsHours: 0.33,
        value: null,
      },
      {
        id: "c",
        code: "knife",
        rarity: "common",
        skills: { attack: 37, criticalChance: 4 },
        source: "opened",
        via: "case1",
        at: iso(600e3),
        cost: 3.8,
        approx: true,
        fate: "scrapped",
        proceeds: 1.2,
        goneAt: iso(500e3),
        sellsHours: null,
        value: null,
      },
      {
        id: "d",
        code: "helmet4",
        rarity: "epic",
        skills: { criticalDamages: 80 },
        source: "unknown",
        at: null,
        cost: null,
        approx: false,
        fate: "sold",
        proceeds: 40,
        goneAt: iso(400e3),
        sellsHours: null,
        value: null,
      },
    ],
    rowsTotal: 4,
    salesWanted: ["tank"],
    approxBefore: "2026-09-08",
    at: iso(),
  });
  it("shows the worker's view: money and result by activity, cases and tiers, the recent pieces", () => {
    state.craftsUserId = ME;
    state.ledger = view();
    render("ledger");
    expect(text()).toContain("Johnny_Sins");
    expect(text()).toContain("23906 transactions");
    expect(text()).toContain("−41.370 g");
    expect(text()).toContain(
      "2 sold, 9 scrapped · 160.200 g in · 1 without a cost on record",
    );
    expect(text()).toContain("2 crafted · 10 from cases · 0 bought · 0 looted");
    const sources = body.querySelector(".lens-sources").textContent;
    expect(sources).toContain("Crafting");
    expect(sources).toContain("Cases");
    expect(sources).toContain("−25.700");
    expect(sources).toContain("−2.570 a opening");
    expect(text()).toContain("Case 10 · cost 38.000");
    expect(text()).toContain("legendary 2");
    expect(text()).toContain("sells ~161.000 g");
    expect(text()).toContain("5 sales · atk 159 · crit 32% · 7 d");
    expect(text()).toContain("after 20 min listed");
    expect(text()).toContain("case 3.800 g≈");
    expect(text()).toContain("before your history");
    expect(text()).toContain("costs before 2026-09-08");
    expect(
      body.querySelectorAll(".lens-crafts tbody tr").length,
    ).toBeGreaterThanOrEqual(4);
    // the pulse: today's money and the estimate incl. held
    expect(desk.pulse(state)).toContain("−41.370 g");
    expect(desk.pulse(state)).toContain("*");
    click('[data-action="desk-window"][data-window="all"]');
    expect(desk.window).toBe("all");
    expect(text()).toContain("8780");
  });
  it("says when the account could not be read, never shows another account's view, and shows the history filling", () => {
    state.craftsUserId = null;
    render("ledger");
    expect(text()).toContain("account not found on this page");
    expect(desk.pulse(state)).toBe("");
    state.craftsUserId = ME;
    state.ledger = {
      ...view(),
      meta: { ...view().meta, userId: "6993b905cd957d3e93bc35a6" },
    };
    state.history = { userId: ME, count: 800, done: false };
    render("ledger");
    expect(text()).toContain("800 transactions so far");
    expect(desk.pulse(state)).toBe("");
    state.ledger = {
      ...view(),
      meta: { ...view().meta, done: false, count: 800 },
    };
    render("ledger");
    expect(text()).toContain("filling from the start of your profile");
    state.historyError = "the API answered 503";
    render("ledger");
    expect(text()).toContain("last read failed");
  });
});
