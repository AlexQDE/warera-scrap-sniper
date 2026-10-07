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
  it("replays the player's own crafts: cost at the day's averages, held pieces at what their roll clears, fates by item id", () => {
    const ME = "697b55e4bcecf3b37667e0d1";
    state.craftsUserId = ME;
    state.crafts = {
      userId: ME,
      username: "Johnny_Sins",
      at: iso(),
      days: 7,
      complete: { crafts: true, sales: true, dismantles: true },
      crafts: [
        {
          id: "a3cb5c",
          code: "tank",
          skills: { attack: 159, criticalChance: 32 },
          at: iso(3600e3),
          scraps: 486,
        },
        {
          id: "b06b3c",
          code: "boots5",
          skills: { dodge: 38 },
          at: iso(3600e3 - 2000),
          scraps: 486,
        },
        {
          id: "d664c5",
          code: "chest5",
          skills: { armor: 46 },
          at: iso(3600e3 - 5000),
          scraps: 486,
        },
        {
          id: "31f44d",
          code: "chest1",
          skills: { armor: 3 },
          at: iso(7200e3),
          scraps: 6,
        },
      ],
      sales: [
        {
          itemId: "d664c5",
          code: "chest5",
          at: iso(1800e3),
          money: 129.396,
          seller: ME,
          buyer: "x",
        },
      ],
      dismantles: [],
      averages: {
        scraps: { "2026-10-03": 0.247778 },
        steel: { "2026-10-03": 1.789756 },
      },
    };
    state.salesByCode = {
      tank: {
        code: "tank",
        at: iso(),
        complete: true,
        fills: fills("tank", [160, 161, 161, 162, 163], {
          attack: 159,
          criticalChance: 32,
        }),
      },
    };
    render("ledger");
    expect(text()).toContain("Johnny_Sins");
    expect(text()).toContain("7 days of your feed");
    expect(requestSales).toHaveBeenCalledWith("boots5"); // the held piece without sales read yet
    expect(requestSales).not.toHaveBeenCalledWith("chest5"); // sold: nothing to price
    // 486 × 0.247778 + 16 × 1.789756 = 149.056 g per craft; the tank clears 161 (five sales of crit 32)
    expect(text()).toContain("149.056");
    expect(text()).toContain("clears 161.000 g");
    expect(text()).toContain("5 sales · atk 159 · crit 32% · 7 d");
    expect(text()).toContain("crit chance 32 · attack 159");
    expect(text()).toContain("sold 129.396 g");
    // realized on the sold chest: 129.396 − 149.056 = −19.660; the held value waits for the boots' price
    expect(text()).toContain("−19.660 g");
    expect(text()).toContain("1 of 2 priced");
    expect(text()).toContain("1 below epic listed, not summed");
    expect(body.querySelectorAll(".lens-crafts tbody tr")).toHaveLength(4);
    // with the boots priced, the held pieces are 161 + 187.25 = 348.25 against 298.112 of inputs: +50.138
    state.salesByCode.boots5 = {
      code: "boots5",
      at: iso(),
      complete: true,
      fills: fills("boots5", [187.25, 187.25, 187.25, 187.25, 187.25], {
        dodge: 38,
      }),
    };
    render("ledger");
    expect(text()).toContain("+50.138 g");
    expect(text()).toContain("348.250 g against 298.112 g of inputs");
    click('[data-action="desk-window"][data-window="7d"]');
    expect(
      body
        .querySelector('[data-action="desk-window"][data-window="7d"]')
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(text()).toContain("Crafted · 7 days");
    expect(text()).toContain("2026-10-03 "); // the day travels with the time in the 7-day view
    // a refresh that failed keeps the last good read on screen, labelled as such
    state.craftsError = "the API answered 503";
    render("ledger");
    expect(text()).toContain(
      "last read failed (the API answered 503): the last good read is shown",
    );
    expect(text()).toContain("clears 161.000 g");
    state.craftsError = null;
    render("ledger");
    expect(text()).not.toContain("last read failed");
    // chosen-slot steel doubles the fee: 486 × 0.247778 + 32 × 1.789756 = 177.692
    settings = preferences({ ...settings, craftSteelMode: "chosen" });
    render("ledger");
    expect(text()).toContain("177.692");
    expect(text()).toContain("chosen-slot steel, twice the fee");
  });
  it("says when the account could not be read off the page, and never shows another account's feed", () => {
    state.craftsUserId = null;
    render("ledger");
    expect(text()).toContain("account not found on this page");
    state.craftsUserId = "697b55e4bcecf3b37667e0d1";
    state.crafts = {
      userId: "6993b905cd957d3e93bc35a6",
      at: iso(),
      crafts: [],
      sales: [],
      dismantles: [],
      averages: {},
    };
    render("ledger");
    expect(text()).toContain("reading…");
    expect(body.querySelector(".lens-crafts")).toBeNull();
    state.craftsError = "the API answered 503";
    render("ledger");
    expect(text()).toContain(
      "Your crafts could not be read: the API answered 503",
    );
  });
  it("says when the feed holds no crafts in the window and when it was not fully covered", () => {
    const ME = "697b55e4bcecf3b37667e0d1";
    state.craftsUserId = ME;
    state.crafts = {
      userId: ME,
      username: null,
      at: iso(),
      days: 7,
      complete: { crafts: true, sales: false, dismantles: true },
      crafts: [],
      sales: [],
      dismantles: [],
      averages: {},
    };
    render("ledger");
    expect(text()).toContain("player …67e0d1");
    expect(text()).toContain("No crafts of yours today (UTC) in the feed");
    expect(text()).toContain("the feed was not fully covered");
  });
});
