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
  it("prices every tier at the asks and values it at the game's averages: random worth, best chosen slot, profit", () => {
    render();
    expect(
      body.querySelectorAll(".lens-board tbody tr.lens-tier"),
    ).toHaveLength(6);
    const epic = body.querySelector('.lens-tier[data-rarity="epic"]');
    // 162 scraps × 0.21 + 8 steel × 1.6 = 46.82 at random; EV 0.3 × 60 + 0.7 × 30 = 39
    expect(epic.textContent).toContain("46.8");
    expect(epic.textContent).toContain("39.0");
    expect(epic.textContent).toContain("−17%");
    expect(epic.textContent).toContain("sniper");
    expect(epic.textContent).toContain("+1%"); // 60 against 162 × 0.21 + 16 × 1.6 = 59.62
    const mythic = body.querySelector('.lens-tier[data-rarity="mythic"]');
    expect(mythic.textContent).toContain("357"); // 1458 × 0.21 + 32 × 1.6
    expect(mythic.textContent).toContain("1/6");
    expect(mythic.textContent).toContain("jet");
    expect(text()).toContain("Best now: epic random −17%");
    expect(text()).toContain("Scraps 0.210");
    expect(text()).toContain("Steel 1.600");
    // the method lives in a tooltip, not in a paragraph
    expect(body.querySelector(".lens-legend")).toBeNull();
    expect(body.querySelector(".lens-help").title).toContain("random craft");
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
    expect(common.textContent).toContain("2.86"); // 6 × 0.21 + 1 × 1.6
    expect(common.textContent).toContain("0/6");
    expect(text()).toContain("Reading item prices…");
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
    expect(detail.textContent).toContain("sniper 60.0 30%");
    expect(detail.textContent).toContain("helmet 30.0 14%");
    const plain = detail.textContent.replace(/\s+/g, " ");
    expect(plain).toContain("162 scraps + 8 steel");
    expect(plain).toContain("chosen slot 16 steel · 59.6 g");
    // 162 scraps back at the 0.2 bid = 32.4; the random craft cost 46.82, so a bad roll costs 14.42
    expect(plain).toContain("bad roll scrapped: 32.4 g back, −14.4 g");
    expect(plain).toContain("sniper: 3 sales · median 60.0 · 55.0–65.0");
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
      "jet: reading sales…",
    );
    state.selectedCode = null;
    render();
    expect(body.querySelector(".lens-tier-detail").textContent).not.toContain(
      "sales",
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
  it("shows the worker's view: the result, the money, the pieces, by activity and tier, the recent pieces", () => {
    state.craftsUserId = ME;
    state.ledger = { ...view(), mode: "eco" };
    state.ledger.windows.today.crafted.worn = 3;
    render("ledger");
    const plain = () => text().replace(/\s+/g, " ");
    expect(plain()).toContain("Johnny_Sins");
    expect(plain()).toContain("23,906 tx");
    // result: crafting −7.716 + cases −25.7
    expect(plain()).toContain("Result −33.4 g");
    expect(plain()).toContain("3 in battle, not counted");
    expect(plain()).toContain("Sold & scrapped −41.4 g");
    expect(plain()).toContain("2 sold · 9 scrapped · 1 without cost");
    expect(plain()).toContain("Pieces 12");
    expect(plain()).toContain("2 crafted · 10 cases");
    expect(plain()).toContain("Crafting −7.72");
    expect(plain()).toContain("Cases −25.7");
    expect(plain()).toContain("Legendary 2 −7.72");
    // the rows: what each cost, where it is now, the result
    expect(plain()).toContain("craft 149");
    expect(plain()).toContain("~161");
    expect(
      body.querySelector('[title="5 sales · atk 159 · crit 32% · 7 d"]'),
    ).not.toBeNull();
    expect(plain()).toContain("sold 129 · 20 min");
    expect(plain()).toContain("case 3.80≈");
    expect(plain()).toContain("scrap 1.20");
    expect(
      body.querySelector('[title="got before your history starts"]'),
    ).not.toBeNull();
    expect(
      body.querySelectorAll(".lens-crafts tbody tr").length,
    ).toBeGreaterThanOrEqual(4);
    // the method lives in a tooltip
    expect(body.querySelector(".lens-legend")).toBeNull();
    expect(body.querySelector(".lens-help").title).toContain(
      "costs before 2026-09-08",
    );
    expect(
      body
        .querySelector('[data-action="ledger-mode"][data-mode="eco"]')
        .getAttribute("aria-pressed"),
    ).toBe("true");
    // the pulse: today's money
    expect(desk.pulse(state)).toContain("−41.4 g");
    expect(desk.pulse(state)).toContain("*");
    click('[data-action="desk-window"][data-window="all"]');
    expect(desk.window).toBe("all");
    expect(text()).toContain("8,780");
  });
  it("says when the account could not be read, never shows another account's view, and shows the history filling", () => {
    state.craftsUserId = null;
    render("ledger");
    expect(text()).toContain("Account not found on this page");
    expect(desk.pulse(state)).toBe("");
    state.craftsUserId = ME;
    state.ledger = {
      ...view(),
      meta: { ...view().meta, userId: "6993b905cd957d3e93bc35a6" },
    };
    state.history = { userId: ME, count: 800, done: false };
    render("ledger");
    expect(text()).toContain("Reading your history · 800 tx");
    expect(desk.pulse(state)).toBe("");
    state.ledger = {
      ...view(),
      meta: { ...view().meta, done: false, count: 800 },
    };
    render("ledger");
    expect(text()).toContain("800 tx, still reading");
    state.historyError = "the API answered 503";
    render("ledger");
    expect(text()).toContain("last read failed");
  });
});
