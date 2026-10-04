// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createCraftDesk, DESK_ID } from "./craftdesk.mjs";
import { DEFAULTS, preferences } from "./settings.mjs";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const iso = (msAgo = 0) => new Date(NOW - msAgo).toISOString();
const book = (bid, ask) => ({
  bid,
  ask,
  bidQty: 1e6,
  askQty: 1e6,
  bids: [{ price: bid, quantity: 1e6 }],
  asks: [{ price: ask, quantity: 1e6 }],
});
const fills = (code, prices) =>
  prices.map((price, i) => ({
    price,
    at: iso((i + 1) * 3600e3),
    state: 100,
    code,
  }));
let desk, settings, state, bar, save, onLedger, rescan, download, requestSales;
const el = () => document.getElementById(DESK_ID);
const click = (selector) => {
  const b = el().querySelector(selector);
  if (!b) throw new Error(`no control ${selector}`);
  b.click();
};
const type = (field, value, event = "input") => {
  const input = el().querySelector(`[data-field="${field}"]`);
  if (!input) throw new Error(`no field ${field}`);
  input.value = value;
  input.dispatchEvent(new Event(event, { bubbles: true }));
};
const render = () => desk.render(state, bar, { after: true });

beforeEach(() => {
  document.body.innerHTML =
    '<main><section id="scrap-sniper-bar"></section><div id="tax"><span>Market tax 5%</span></div></main>';
  bar = document.getElementById("scrap-sniper-bar");
  settings = preferences({ ...DEFAULTS, craftCollapsed: false });
  save = vi.fn((patch) => {
    settings = preferences({ ...settings, ...patch });
  });
  onLedger = vi.fn(async (entries) => {
    state.ledger = { version: 1, entries };
    return { ledger: state.ledger };
  });
  rescan = vi.fn();
  download = vi.fn();
  requestSales = vi.fn();
  desk = createCraftDesk({
    settings: () => settings,
    save,
    onLedger,
    requestSales,
    refresh: vi.fn(),
    rescan,
    now: () => NOW,
    download,
  });
  state = {
    settings,
    book: { at: iso(), ...book(0.2, 0.21) },
    cases: { at: iso(), books: { steel: book(1.5, 1.6) } },
    salesByCode: {},
    ledger: { version: 1, entries: [] },
    taxOnPage: 5,
    setup: null,
    busy: false,
    action: vi.fn(),
  };
});
afterEach(() => {
  desk.clear();
  document.body.innerHTML = "";
});

describe("Craft Desk panel", () => {
  it("mounts once after the equipment panel, compact by default, and clears cleanly", () => {
    settings = preferences({ ...settings, craftCollapsed: true });
    render();
    render();
    expect(document.querySelectorAll(`#${DESK_ID}`)).toHaveLength(1);
    expect(bar.nextElementSibling).toBe(el());
    expect(el().textContent).toContain("Craft Desk");
    expect(el().textContent).toContain("Open Details");
    expect(el().querySelector(".lens-matrix")).toBeNull();
    desk.clear();
    expect(el()).toBeNull();
    expect(document.querySelector("[data-lens]")).toBeNull();
  });
  it("shows the setup notice instead of numbers when the key is missing", () => {
    state.setup = "Add your WarEra API key in extension settings.";
    render();
    expect(el().textContent).toContain("Add your WarEra API key");
    expect(el().querySelector(".lens-matrix")).toBeNull();
  });
  it("fills the 6×6 matrix with 'no recipe' until recipes are entered, and labels the quote sources", () => {
    render();
    const cells = el().querySelectorAll(".lens-matrix td button");
    expect(cells).toHaveLength(36);
    expect([...cells].every((c) => c.textContent === "no recipe")).toBe(true);
    expect(el().textContent).toContain("no recipes entered yet");
    expect(el().textContent).toContain("scraps: best ask (fresh)");
    expect(el().textContent).toContain("steel: best ask (fresh)");
    expect(el().textContent).toContain("read off the page notice");
    expect(el().querySelector('[data-field="scrapPrice"]').value).toBe("0.21");
  });
  it("works a craft through once its recipe is saved: cost, buy-now against bids, EV over outcomes, ceilings on the tick", () => {
    render();
    click('[data-action="desk-pick"][data-code="boots5"]');
    expect(rescan).toHaveBeenCalled();
    render();
    expect(requestSales).toHaveBeenCalledWith("boots5");
    expect(el().textContent).toContain("legendary boots");
    expect(el().textContent).toContain(
      "not entered: read it off the game's craft screen",
    );
    type("recipe-scraps", "10");
    type("recipe-steel", "2");
    click('[data-action="desk-save-recipe"]');
    expect(save).toHaveBeenCalledWith({
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    render();
    const text = () => el().textContent;
    expect(text()).toContain("5.300 g"); // 10 × 0.21 + 2 × 1.6
    expect(text()).toContain("Buy now at the asks");
    expect(text()).toContain("Place bids at the best bid");
    expect(text()).toContain("5.000 g"); // 10 × 0.2 + 2 × 1.5
    expect(text()).toContain("saves 0.300 g against buying now if it does");
    expect(text()).toContain("unavailable");
    expect(text()).toContain("no recent fills read for this item");
    expect(
      el().querySelector('[data-action="desk-pick"][data-code="boots5"]')
        .textContent,
    ).toBe("no fills");
    state.salesByCode = {
      boots5: {
        code: "boots5",
        at: iso(),
        complete: true,
        fills: fills("boots5", [10, 11, 12, 13, 14]),
      },
    };
    render();
    expect(text()).toContain("11.400 g"); // listing 12 nets 11.4 after the 5% page tax
    expect(text()).toContain("sells like recent fills");
    expect(text()).toContain("+6.100 g"); // 11.4 − 5.3
    expect(text()).toContain("ROI +115.1%");
    expect(
      el().querySelector('[data-action="desk-pick"][data-code="boots5"]')
        .textContent,
    ).toBe("+115%");
    expect(text()).toContain("scraps ≤ 0.820 g"); // (11.4 − 3.2) / 10
    expect(text()).toContain("steel ≤ 4.650 g"); // (11.4 − 2.1) / 2
    expect(text()).toContain("For 20% ROI");
    expect(text()).toContain("scraps ≤ 0.630 g"); // (9.5 − 3.2) / 10
    expect(text()).toContain("steel ≤ 3.700 g");
    expect(text()).toContain("Balanced");
    expect(text()).toContain("12.000 g");
    expect(text()).toContain("needs 8 comparable fills (5 now)");
    expect(text()).toContain("5 comparable fills in 72 h");
  });
  it("takes a typed price over the quote, says so, keeps the caret on the field, and returns to quotes on request", () => {
    render();
    const input = el().querySelector('[data-field="scrapPrice"]');
    input.focus();
    type("scrapPrice", "0.19", "change");
    expect(rescan).toHaveBeenCalled();
    render();
    expect(el().textContent).toContain("scraps: your price");
    expect(document.activeElement).toBe(
      el().querySelector('[data-field="scrapPrice"]'),
    );
    expect(el().querySelector('[data-field="scrapPrice"]').value).toBe("0.19");
    click('[data-action="desk-quotes"]');
    render();
    expect(el().textContent).toContain("scraps: best ask (fresh)");
    type("batch", "4", "change");
    expect(save).toHaveBeenCalledWith({ craftBatch: "4" });
    type("taxPct", "", "change");
    expect(save).toHaveBeenCalledWith({ taxPct: null });
  });
  it("says when quotes are missing or stale instead of pricing", () => {
    state.cases = null;
    state.book = { ...state.book, at: iso(120e3) };
    render();
    expect(el().textContent).toContain("steel: no ask quote yet");
    expect(el().textContent).toContain("scraps: best ask (stale)");
    expect(el().querySelector(".lens-status").dataset.status).toBe("stale");
  });
});

describe("craft ledger in the desk", () => {
  function recordBoots() {
    settings = preferences({
      ...settings,
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    render();
    click('[data-action="desk-pick"][data-code="boots5"]');
    render();
    click('[data-action="desk-ledger-new"]');
    render();
  }
  it("records a craft from the desk with inferred prices, then lists it unsold with nothing realized", async () => {
    recordBoots();
    expect(el().querySelector('[data-field="form-scraps"]').value).toBe("10");
    expect(el().querySelector('[data-field="form-scrapPrice"]').value).toBe(
      "0.21",
    );
    expect(el().textContent).toContain("Prices are inferred");
    type("form-stat", "271");
    click('[data-action="desk-ledger-add"]');
    await Promise.resolve();
    expect(onLedger).toHaveBeenCalledTimes(1);
    const entry = onLedger.mock.calls[0][0][0];
    expect(entry).toMatchObject({
      code: "boots5",
      state: "crafted",
      costBasis: 5.3,
      inputs: {
        scraps: 10,
        steel: 2,
        scrapPrice: 0.21,
        steelPrice: 1.6,
        priceSource: "inferred",
      },
      result: { rarity: "legendary", stat: 271, durability: 100 },
    });
    await Promise.resolve();
    render();
    expect(el().textContent).toContain(
      "Recorded legendary boots (inferred prices)",
    );
    expect(el().textContent).toContain("basis 5.300 g (inferred)");
    expect(el().textContent).toContain("Open pieces");
    expect(el().textContent).toContain("an estimate, not realized profit");
    expect(el().textContent).toContain("Realized (sold)");
    expect(el().textContent).toContain("+0.000 g");
  });
  it("marks a manual price, lists, sells with proceeds, and realizes the difference", async () => {
    recordBoots();
    type("form-scrapPrice", "0.25", "change");
    click('[data-action="desk-ledger-add"]');
    await Promise.resolve();
    expect(onLedger.mock.calls[0][0][0].inputs).toMatchObject({
      scrapPrice: 0.25,
      priceSource: "manual",
    });
    await Promise.resolve();
    render();
    const id = onLedger.mock.calls[0][0][0].id;
    click(
      `[data-action="desk-ledger-move"][data-type="list"][data-id="${id}"]`,
    );
    render();
    type("pending-price", "12");
    click('[data-action="desk-ledger-confirm"]');
    await Promise.resolve();
    await Promise.resolve();
    render();
    expect(el().textContent).toContain(
      "listed at 12.000 g · unsold: nothing realized",
    );
    click(
      `[data-action="desk-ledger-move"][data-type="sell"][data-id="${id}"]`,
    );
    render();
    click('[data-action="desk-ledger-confirm"]'); // no proceeds typed
    render();
    expect(el().textContent).toContain(
      "a sale needs the proceeds you received",
    );
    type("pending-price", "11.4");
    click('[data-action="desk-ledger-confirm"]');
    await Promise.resolve();
    await Promise.resolve();
    render();
    expect(el().textContent).toContain("sold for 11.400 g");
    expect(el().textContent).toContain("+5.700 g"); // 11.4 − (10 × 0.25 + 2 × 1.6)
    expect(el().textContent).toContain("1 sold");
  });
  it("exports a ledger file and merges a pasted export, skipping junk", async () => {
    recordBoots();
    click('[data-action="desk-ledger-add"]');
    await Promise.resolve();
    await Promise.resolve();
    render();
    click('[data-action="desk-export"]');
    expect(download).toHaveBeenCalledTimes(1);
    const [name, text] = download.mock.calls[0];
    expect(name).toBe("warera-plus-ledger-2026-10-03.json");
    expect(JSON.parse(text)).toMatchObject({
      kind: "craft-ledger",
      version: 1,
    });
    render();
    expect(el().textContent).toContain("Exported 1 entries");
    click('[data-action="desk-import-toggle"]');
    render();
    const other = {
      ...JSON.parse(text).entries[0],
      id: "other-0001",
      label: "imported one",
    };
    type(
      "import-text",
      JSON.stringify({ kind: "craft-ledger", entries: [other, { id: "x" }] }),
    );
    click('[data-action="desk-import-paste"]');
    await Promise.resolve();
    await Promise.resolve();
    render();
    expect(el().textContent).toContain(
      "Imported: 1 added, 0 updated, 1 skipped",
    );
    expect(el().textContent).toContain("imported one");
    expect(onLedger.mock.calls.at(-1)[0]).toHaveLength(2);
    click('[data-action="desk-import-toggle"]');
    render();
    type("import-text", "{nope");
    click('[data-action="desk-import-paste"]');
    render();
    expect(el().textContent).toContain("Import failed: not JSON");
  });
});
