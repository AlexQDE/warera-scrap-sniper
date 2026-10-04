// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createCraftDesk, DESK_ID } from "./craftdesk.mjs";
import { DEFAULTS, preferences } from "./settings.mjs";
import { applyRecipeOps } from "./craftdata.mjs";

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
let clock = NOW;
/** What the worker does with a write: merge the changed entries and drop the removed ids. */
async function applyOps({ changed = [], removed = [] } = {}) {
  const byId = new Map((state.ledger?.entries ?? []).map((e) => [e.id, e]));
  for (const e of changed) byId.set(e.id, e);
  for (const id of removed) byId.delete(id);
  state.ledger = {
    version: 1,
    revision: (state.ledger?.revision ?? 0) + 1,
    entries: [...byId.values()].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    ),
  };
  return { ledger: state.ledger };
}
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
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  clock = NOW;
  document.body.innerHTML =
    '<main><section id="scrap-sniper-bar"></section><div id="tax"><span>Market tax 5%</span></div></main>';
  bar = document.getElementById("scrap-sniper-bar");
  settings = preferences({ ...DEFAULTS, craftCollapsed: false });
  save = vi.fn((patch) => {
    // what the worker does: recipe operations are applied to the stored table
    const recipes = patch.craftRecipeOps
      ? {
          craftRecipes: applyRecipeOps(
            settings.craftRecipes,
            patch.craftRecipeOps,
          ),
        }
      : {};
    settings = preferences({ ...settings, ...patch, ...recipes });
    return settings;
  });
  onLedger = vi.fn(applyOps);
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
    now: () => clock,
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
  it("fills the 6×6 matrix from the game's recipe table (every cell priced, waiting for fills), and labels the quote sources", () => {
    render();
    const cells = el().querySelectorAll(".lens-matrix td button");
    expect(cells).toHaveLength(36);
    expect([...cells].every((c) => c.textContent === "no fills")).toBe(true);
    expect(el().textContent).toContain("the game's recipes, slot chosen");
    expect(el().textContent).not.toContain("overridden by you");
    expect(el().textContent).not.toContain("no recipe");
    expect(el().textContent).toContain("scraps: best ask (fresh)");
    expect(el().textContent).toContain("steel: best ask (fresh)");
    expect(el().textContent).toContain("read off the page notice");
    expect(el().querySelector('[data-field="scrapPrice"]').value).toBe("0.21");
  });
  it("works a craft through once its recipe is saved: cost, buy-now against bids, EV over outcomes, ceilings on the tick", async () => {
    render();
    click('[data-action="desk-pick"][data-code="boots5"]');
    expect(rescan).toHaveBeenCalled();
    render();
    expect(requestSales).toHaveBeenCalledWith("boots5");
    expect(el().textContent).toContain("legendary boots");
    // The game's recipe applies before anything is typed: 486 scraps + 32 steel at 0.21 / 1.6.
    expect(el().textContent).toContain(
      "the game's recipe, slot chosen: 486 scraps + 32 steel (a random craft of this tier burns half the steel, 16)",
    );
    expect(el().textContent).toContain("153.260 g"); // 486 × 0.21 + 32 × 1.6
    // The reroll floor: 486 scraps back at the 0.2 bid = 97.2 g, 32 steel gone = 51.2 g, so a roll sent back costs 56.06 g.
    expect(el().textContent).toContain(
      "dismantling it returns all 486 scraps (97.200 g at the 0.200 scrap bid); the 32 steel is gone (51.200 g). A roll you send straight back to scraps costs 56.060 g, not the 153.260 g input.",
    );
    expect(el().querySelector('[data-field="recipe-scraps"]').value).toBe(
      "486",
    );
    expect(el().querySelector('[data-action="desk-forget-recipe"]')).toBeNull();
    type("recipe-scraps", "10");
    type("recipe-steel", "2");
    click('[data-action="desk-save-recipe"]');
    expect(save).toHaveBeenCalledWith({
      craftRecipeOps: { set: { boots5: { scraps: 10, steel: 2 } } },
    });
    await flush();
    render();
    const text = () => el().textContent;
    expect(text()).toContain(
      "your recipe, stored on this browser (the game's table says 486 scraps + 32 steel)",
    );
    expect(text()).toContain("1 overridden by you");
    expect(
      el().querySelector('[data-action="desk-forget-recipe"]'),
    ).not.toBeNull();
    expect(text()).toContain("5.300 g"); // 10 × 0.21 + 2 × 1.6
    expect(text()).toContain("Buy now at the asks");
    expect(text()).toContain("Place bids at the best bid");
    expect(text()).toContain("5.000 g"); // 10 × 0.2 + 2 × 1.5
    expect(text()).toContain("saves 0.300 g against buying now if it does");
    expect(text()).toContain("unavailable");
    expect(text()).toContain("no recent fills read for this item");
    expect(text()).toContain("Break-even listing 5.300 g"); // the seller keeps the listing: the cost itself, on the tick
    expect(text()).toContain("the tax is the buyer's");
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
    // The median listing of 12 is what the seller nets: the 5% page rate is the buyer's and only changes what a buyer is shown.
    expect(text()).toContain("Expected proceeds per craft12.000 g");
    expect(text()).toContain("the market tax being the buyer's");
    expect(text()).not.toContain("11.400 g");
    expect(text()).toContain("sells like recent fills");
    expect(text()).toContain("+6.700 g"); // 12 − 5.3
    expect(text()).toContain("ROI +126.4%");
    expect(
      el().querySelector('[data-action="desk-pick"][data-code="boots5"]')
        .textContent,
    ).toBe("+126%");
    expect(text()).toContain("best legendary boots +126%");
    expect(text()).toContain("scraps ≤ 0.880 g"); // (12 − 3.2) / 10
    expect(text()).toContain("steel ≤ 4.950 g"); // (12 − 2.1) / 2
    expect(text()).toContain("For 20% ROI");
    expect(text()).toContain("scraps ≤ 0.680 g"); // (10 − 3.2) / 10
    expect(text()).toContain("steel ≤ 3.950 g");
    expect(text()).toContain("a buyer in a 5% country is shown 12.600 g"); // 12 × 1.05
    expect(text()).toContain("Balanced");
    expect(text()).toContain("12.000 g");
    expect(text()).toContain("needs 8 comparable fills (5 now)");
    expect(text()).toContain("5 comparable fills in 72 h");
  });
  it("paints a cell without a usable price as muted, never as profitable", () => {
    settings = preferences({
      ...settings,
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    state.cases = null; // no steel quote
    state.salesByCode = {
      boots5: {
        code: "boots5",
        at: iso(),
        complete: true,
        fills: fills("boots5", [10, 11, 12, 13, 14]),
      },
    };
    render();
    const cell = el().querySelector(
      '[data-action="desk-pick"][data-code="boots5"]',
    );
    expect(cell.textContent).toBe("no price");
    expect(cell.className).toBe("lens-muted");
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
  it("shows settings-backed fields from the settings once saved, so a change made elsewhere is not shadowed", async () => {
    render();
    type("batch", "4", "change");
    await flush();
    render();
    expect(el().querySelector('[data-field="batch"]').value).toBe("4");
    settings = preferences({ ...settings, craftBatch: 10 }); // changed in the popup
    render();
    expect(el().querySelector('[data-field="batch"]').value).toBe("10");
  });
  it("keeps keyboard focus on the picked cell, not the first cell, across the re-render", () => {
    render();
    const cell = el().querySelector(
      '[data-action="desk-pick"][data-code="boots5"]',
    );
    cell.focus();
    cell.click();
    render();
    expect(document.activeElement.dataset.code).toBe("boots5");
    expect(document.activeElement.getAttribute("aria-pressed")).toBe("true");
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
    await flush();
    expect(onLedger).toHaveBeenCalledTimes(1);
    const entry = onLedger.mock.calls[0][0].changed[0];
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
    render();
    expect(el().querySelector(".lens-form")).toBeNull(); // the form closed on a confirmed save
    expect(el().textContent).toContain(
      "Recorded legendary boots (inferred prices)",
    );
    expect(el().textContent).toContain("basis 5.300 g (inferred)");
    expect(el().textContent).toContain("Open pieces");
    expect(el().textContent).toContain("an estimate, not realized profit");
    expect(el().textContent).toContain("Realized (sold)");
    expect(el().textContent).toContain("+0.000 g");
  });
  it("calls the basis manual only when every used price was typed, lists, sells with proceeds, and realizes the difference", async () => {
    recordBoots();
    type("form-scrapPrice", "0.25", "change");
    render();
    expect(el().textContent).toContain("Prices are inferred"); // steel still comes from the quote
    type("form-steelPrice", "1.6", "change");
    render();
    expect(el().textContent).toContain("Prices are manual");
    click('[data-action="desk-ledger-add"]');
    await flush();
    expect(onLedger.mock.calls[0][0].changed[0].inputs).toMatchObject({
      scrapPrice: 0.25,
      steelPrice: 1.6,
      priceSource: "manual",
    });
    render();
    const id = onLedger.mock.calls[0][0].changed[0].id;
    click(
      `[data-action="desk-ledger-move"][data-type="list"][data-id="${id}"]`,
    );
    render();
    type("pending-price", "12");
    click('[data-action="desk-ledger-confirm"]');
    await flush();
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
    await flush();
    render();
    expect(el().textContent).toContain("sold for 11.400 g");
    expect(el().textContent).toContain("+5.700 g"); // 11.4 − (10 × 0.25 + 2 × 1.6)
    expect(el().textContent).toContain("1 sold");
  });
  it("never reports a save the worker did not confirm, and keeps the form for another try", async () => {
    onLedger.mockImplementation(async () => null); // the extension did not answer
    recordBoots();
    click('[data-action="desk-ledger-add"]');
    await flush();
    render();
    expect(el().textContent).toContain("Ledger: not saved");
    expect(el().textContent).not.toContain("Recorded");
    expect(el().querySelector(".lens-form")).not.toBeNull();
    expect(state.ledger.entries).toHaveLength(0);
    onLedger.mockImplementation(async () => ({
      error: "too-large",
      message: "The craft ledger is too large",
    }));
    click('[data-action="desk-ledger-add"]');
    await flush();
    render();
    expect(el().textContent).toContain("Ledger: The craft ledger is too large");
    expect(el().querySelector(".lens-form")).not.toBeNull();
  });
  it("takes one ledger write at a time: a second move during a save is ignored and the buttons are disabled", async () => {
    recordBoots();
    click('[data-action="desk-ledger-add"]');
    await flush();
    render();
    const id = onLedger.mock.calls[0][0].changed[0].id;
    let release;
    onLedger.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            state.ledger = { version: 1, entries: [] };
            resolve({ ledger: state.ledger });
          };
        }),
    );
    click(
      `[data-action="desk-ledger-move"][data-type="scrap"][data-id="${id}"]`,
    );
    render();
    expect(
      el().querySelector(`[data-action="desk-ledger-move"][data-id="${id}"]`)
        .disabled,
    ).toBe(true);
    click(
      `[data-action="desk-ledger-move"][data-type="keep"][data-id="${id}"]`,
    );
    expect(onLedger).toHaveBeenCalledTimes(2); // the second move did not start a save
    release();
    await flush();
    render();
    expect(
      el().querySelector(`[data-action="desk-ledger-move"]`)?.disabled ?? false,
    ).toBe(false);
  });
  it("exports a ledger file and merges a pasted export, skipping junk", async () => {
    recordBoots();
    click('[data-action="desk-ledger-add"]');
    await flush();
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
    await flush();
    render();
    expect(el().textContent).toContain(
      "Imported: 1 added, 0 updated, 1 skipped",
    );
    expect(el().textContent).toContain("imported one");
    expect(onLedger.mock.calls.at(-1)[0].changed).toHaveLength(1); // only the imported entry travels
    expect(state.ledger.entries).toHaveLength(2);
    click('[data-action="desk-import-toggle"]');
    render();
    type("import-text", "{nope");
    click('[data-action="desk-import-paste"]');
    render();
    expect(el().textContent).toContain("Import failed: not JSON");
  });
});

describe("second review round", () => {
  const worn = (code, prices, hours, state) =>
    prices.map((price, i) => ({
      price,
      at: iso(hours[i] * 3600e3),
      state,
      code,
    }));
  it("measures the pace over the same comparable fills as the median", () => {
    settings = preferences({
      ...settings,
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    state.salesByCode = {
      boots5: {
        code: "boots5",
        at: iso(),
        complete: true,
        fills: [
          ...worn("boots5", [10, 11, 12, 13, 14], [1, 2, 3, 4, 5], 100),
          ...worn(
            "boots5",
            [1, 1, 1, 1, 1, 1, 1],
            [10, 11, 12, 13, 14, 15, 16],
            40,
          ),
        ],
      },
    };
    render();
    click('[data-action="desk-pick"][data-code="boots5"]');
    render();
    expect(el().textContent).toContain("Evidence: 5 comparable fills");
    expect(el().textContent).toContain("pace 24.0/day"); // 5 fills over 5 h, not 12 over 16 h
  });
  it("keeps the typed setting and says so when the save was not applied", async () => {
    save.mockImplementation(() => undefined); // the extension did not answer
    render();
    type("batch", "4", "change");
    await flush();
    render();
    expect(el().querySelector('[data-field="batch"]').value).toBe("4");
    expect(el().textContent).toContain("Settings: not saved");
  });
  it("labels a form without quantities as inferred, never vacuously manual", () => {
    render();
    click('[data-action="desk-ledger-new"]');
    render();
    expect(el().textContent).toContain("Prices are inferred");
  });
  it("blocks a pasted import while a save is running, on the import path itself", async () => {
    settings = preferences({
      ...settings,
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    render();
    click('[data-action="desk-pick"][data-code="boots5"]');
    render();
    click('[data-action="desk-ledger-new"]');
    render();
    let release;
    onLedger.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ ledger: (state.ledger = { version: 1, entries: [] }) });
        }),
    );
    click('[data-action="desk-ledger-add"]');
    render();
    click('[data-action="desk-import-toggle"]');
    render();
    type("import-text", JSON.stringify({ kind: "craft-ledger", entries: [] }));
    el().querySelector('[data-action="desk-import-paste"]').disabled = false; // as if the button had been enabled
    click('[data-action="desk-import-paste"]');
    expect(onLedger).toHaveBeenCalledTimes(1);
    render();
    expect(el().textContent).toContain("a save is still running");
    release();
    await flush();
  });
  it("does not close a form opened while an earlier save was finishing", async () => {
    settings = preferences({
      ...settings,
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    render();
    click('[data-action="desk-pick"][data-code="boots5"]');
    render();
    click('[data-action="desk-ledger-new"]');
    render();
    let release;
    onLedger.mockImplementation(
      (ops) =>
        new Promise((resolve) => {
          release = () => applyOps(ops).then(resolve);
        }),
    );
    click('[data-action="desk-ledger-add"]');
    render();
    click('[data-action="desk-ledger-new"]'); // a second form, opened during the save
    render();
    release();
    await flush();
    render();
    expect(el().querySelector(".lens-form")).not.toBeNull();
    expect(el().textContent).toContain("Recorded legendary boots");
  });
  it("stays put before its anchor when only the extension's own nodes sit between them", () => {
    const tax = document.getElementById("tax");
    desk.render(state, tax, { after: false });
    const node = el();
    const own = document.createElement("div");
    own.dataset.lens = "";
    tax.insertAdjacentElement("beforebegin", own); // between the desk and the tax notice
    desk.render(state, tax, { after: false });
    expect(el()).toBe(node);
    expect(node.nextElementSibling).toBe(own);
    const foreign = document.createElement("div");
    tax.insertAdjacentElement("beforebegin", foreign); // the page moved: the desk follows
    desk.render(state, tax, { after: false });
    expect(el().nextElementSibling).toBe(tax);
  });
  it("names the removed id on a deletion so another tab's copy cannot bring it back", async () => {
    settings = preferences({
      ...settings,
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    render();
    click('[data-action="desk-pick"][data-code="boots5"]');
    render();
    click('[data-action="desk-ledger-new"]');
    render();
    click('[data-action="desk-ledger-add"]');
    await flush();
    render();
    const id = onLedger.mock.calls[0][0].changed[0].id;
    click(
      `[data-action="desk-ledger-move"][data-type="scrap"][data-id="${id}"]`,
    );
    await flush();
    render();
    click(
      `[data-action="desk-ledger-move"][data-type="delete"][data-id="${id}"]`,
    );
    await flush();
    expect(onLedger).toHaveBeenLastCalledWith({
      changed: [],
      removed: [id],
      baseRevision: 2, // the revision the row was rendered from
    });
    onLedger.mockImplementation(async (ops) => ({
      ...(await applyOps(ops)),
      merged: true,
    }));
    render();
    click('[data-action="desk-ledger-new"]');
    render();
    click('[data-action="desk-ledger-add"]');
    await flush();
    render();
    expect(el().textContent).toContain(
      "merged with changes another tab made meanwhile",
    );
  });
  it("lets fills age out of the 72 h window as time passes, even with the cell cached", () => {
    settings = preferences({
      ...settings,
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    state.salesByCode = {
      boots5: {
        code: "boots5",
        at: iso(),
        complete: true,
        fills: [10, 11, 12, 13, 14].map((price, i) => ({
          price,
          at: iso((70 + i * 0.4) * 3600e3),
          state: 100,
          code: "boots5",
        })),
      },
    };
    render();
    const cell = () =>
      el().querySelector('[data-action="desk-pick"][data-code="boots5"]')
        .textContent;
    expect(cell()).toBe("+126%");
    clock = NOW + 3 * 3600e3;
    render();
    expect(cell()).toBe("0/5 fills");
  });
  it("keeps the typed recipe and says so when the save was not confirmed, and forgets by operation", async () => {
    render();
    click('[data-action="desk-pick"][data-code="boots5"]');
    render();
    type("recipe-scraps", "10");
    type("recipe-steel", "2");
    save.mockImplementationOnce(() => undefined); // the extension did not answer
    click('[data-action="desk-save-recipe"]');
    await flush();
    render();
    expect(el().querySelector('[data-field="recipe-scraps"]').value).toBe("10");
    expect(el().querySelector('[data-field="recipe-steel"]').value).toBe("2");
    expect(el().textContent).toContain("Recipe: not saved");
    expect(el().textContent).not.toContain("saved on this browser");
    click('[data-action="desk-save-recipe"]');
    await flush();
    render();
    expect(el().textContent).toContain(
      "Recipe for legendary boots saved on this browser",
    );
    click('[data-action="desk-forget-recipe"]');
    expect(save).toHaveBeenLastCalledWith({
      craftRecipeOps: { remove: ["boots5"] },
    });
    await flush();
    render();
    expect(el().textContent).toContain(
      "Recipe override for legendary boots removed; the game's recipe applies",
    );
    // Back on the game's recipe: the cell is priced again and waits for fills, never "no recipe".
    expect(
      el().querySelector('[data-action="desk-pick"][data-code="boots5"]')
        .textContent,
    ).toBe("no fills");
    expect(el().querySelector('[data-field="recipe-scraps"]').value).toBe(
      "486",
    );
  });
  it("clears only the numbers the completed recipe save carried: another item's numbers typed meanwhile stay", async () => {
    render();
    click('[data-action="desk-pick"][data-code="boots5"]');
    render();
    type("recipe-scraps", "10");
    type("recipe-steel", "2");
    const apply = save.getMockImplementation();
    let confirm;
    save.mockImplementationOnce(
      (patch) =>
        new Promise((resolve) => {
          confirm = () => resolve(apply(patch));
        }),
    );
    click('[data-action="desk-save-recipe"]');
    render();
    // while the worker is busy, the player moves on to the helmet and types its recipe
    click('[data-action="desk-pick"][data-code="helmet5"]');
    render();
    type("recipe-scraps", "7");
    type("recipe-steel", "1");
    confirm();
    await flush();
    render();
    expect(desk.selected).toBe("helmet5");
    expect(el().querySelector('[data-field="recipe-scraps"]').value).toBe("7");
    expect(el().querySelector('[data-field="recipe-steel"]').value).toBe("1");
    expect(el().textContent).toContain(
      "Recipe for legendary boots saved on this browser",
    );
    expect(settings.craftRecipes).toEqual({ boots5: { scraps: 10, steel: 2 } });
    click('[data-action="desk-save-recipe"]');
    await flush();
    expect(settings.craftRecipes.helmet5).toEqual({ scraps: 7, steel: 1 });
  });
  it("keeps numbers retyped for the same item while its save was in flight", async () => {
    render();
    click('[data-action="desk-pick"][data-code="boots5"]');
    render();
    type("recipe-scraps", "10");
    type("recipe-steel", "2");
    const apply = save.getMockImplementation();
    let confirm;
    save.mockImplementationOnce(
      (patch) =>
        new Promise((resolve) => {
          confirm = () => resolve(apply(patch));
        }),
    );
    click('[data-action="desk-save-recipe"]');
    render();
    type("recipe-scraps", "12");
    confirm();
    await flush();
    render();
    expect(settings.craftRecipes.boots5).toEqual({ scraps: 10, steel: 2 });
    expect(el().querySelector('[data-field="recipe-scraps"]').value).toBe("12");
    expect(el().querySelector('[data-field="recipe-steel"]').value).toBe("2");
    // nothing typed since: the confirmed save clears its own numbers and the stored recipe shows
    click('[data-action="desk-save-recipe"]');
    await flush();
    render();
    expect(settings.craftRecipes.boots5).toEqual({ scraps: 12, steel: 2 });
    expect(el().querySelector('[data-field="recipe-scraps"]').value).toBe("12");
  });
  it("says when a move was not applied because the entry was deleted in another tab, instead of claiming it", async () => {
    settings = preferences({
      ...settings,
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    render();
    click('[data-action="desk-pick"][data-code="boots5"]');
    render();
    click('[data-action="desk-ledger-new"]');
    render();
    click('[data-action="desk-ledger-add"]');
    await flush();
    render();
    const id = onLedger.mock.calls[0][0].changed[0].id;
    // the worker: another tab deleted the entry since this tab read, so the edit is dropped
    onLedger.mockImplementationOnce(async () => {
      state.ledger = { ...state.ledger, revision: 9, entries: [] };
      return { ledger: state.ledger, merged: true, dropped: [id] };
    });
    click(
      `[data-action="desk-ledger-move"][data-type="scrap"][data-id="${id}"]`,
    );
    await flush();
    render();
    expect(el().textContent).toContain(
      "Ledger: not applied, the entry was deleted in another tab meanwhile",
    );
    expect(el().textContent).not.toContain("Marked scrapped");
    expect(el().textContent).toContain("No crafts recorded yet");
  });
  it("writes with the revision its rows were rendered from, not a newer one picked up since, so an edit of a row rendered before a deletion still loses", async () => {
    settings = preferences({
      ...settings,
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    render();
    click('[data-action="desk-pick"][data-code="boots5"]');
    render();
    click('[data-action="desk-ledger-new"]');
    render();
    click('[data-action="desk-ledger-add"]');
    await flush();
    desk.render({ ...state }, bar, { after: true }); // the rows on screen come from revision 1
    const id = onLedger.mock.calls[0][0].changed[0].id;
    expect(state.ledger.revision).toBe(1);
    // another tab deleted the entry; the tab's refresh has landed, the re-render has not run yet
    state.ledger = { ...state.ledger, revision: 2, entries: [] };
    click(
      `[data-action="desk-ledger-move"][data-type="keep"][data-id="${id}"]`,
    );
    await flush();
    expect(onLedger).toHaveBeenLastCalledWith({
      changed: [expect.objectContaining({ id, state: "kept" })],
      removed: [],
      baseRevision: 1,
    });
  });
  it("says when a move was not applied because the entry was changed in another tab, and shows that state", async () => {
    settings = preferences({
      ...settings,
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    render();
    click('[data-action="desk-pick"][data-code="boots5"]');
    render();
    click('[data-action="desk-ledger-new"]');
    render();
    click('[data-action="desk-ledger-add"]');
    await flush();
    render();
    const entry = onLedger.mock.calls[0][0].changed[0];
    // the worker: another tab sold the entry since this tab read, so the move conflicts and the sold copy comes back
    const sold = {
      ...entry,
      state: "sold",
      listing: { price: 7, at: iso() },
      sale: { proceeds: 7, at: iso(), source: "manual" },
      revision: 9,
    };
    onLedger.mockImplementationOnce(async () => {
      state.ledger = { ...state.ledger, revision: 9, entries: [sold] };
      return {
        ledger: state.ledger,
        merged: true,
        dropped: [],
        conflicts: [entry.id],
      };
    });
    click(
      `[data-action="desk-ledger-move"][data-type="keep"][data-id="${entry.id}"]`,
    );
    await flush();
    render();
    expect(el().textContent).toContain(
      "Ledger: not applied, the entry was changed in another tab meanwhile; its current state is shown",
    );
    expect(el().textContent).not.toContain("Marked kept");
    expect(el().textContent).toContain("1 sold · 7.000 g received");
  });
  it("returns to quotes without discarding a pending price, a pasted import or a recipe being entered", async () => {
    settings = preferences({
      ...settings,
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    render();
    click('[data-action="desk-pick"][data-code="boots5"]');
    render();
    click('[data-action="desk-ledger-new"]');
    render();
    click('[data-action="desk-ledger-add"]');
    await flush();
    render();
    const id = onLedger.mock.calls[0][0].changed[0].id;
    click(
      `[data-action="desk-ledger-move"][data-type="list"][data-id="${id}"]`,
    );
    render();
    type("pending-price", "9");
    type("scrapPrice", "0.19", "change");
    render();
    expect(el().textContent).toContain("scraps: your price");
    click('[data-action="desk-import-toggle"]');
    render();
    type("import-text", "{not pasted in full yet");
    click('[data-action="desk-pick"][data-code="helmet5"]');
    render();
    type("recipe-scraps", "7");
    type("recipe-steel", "1");
    click('[data-action="desk-quotes"]');
    render();
    expect(el().textContent).toContain("scraps: best ask (fresh)");
    expect(el().querySelector('[data-field="pending-price"]').value).toBe("9");
    expect(el().querySelector('[data-field="import-text"]').value).toBe(
      "{not pasted in full yet",
    );
    expect(el().querySelector('[data-field="recipe-scraps"]').value).toBe("7");
    expect(el().querySelector('[data-field="recipe-steel"]').value).toBe("1");
  });
  it("refuses to list without a price, keeps the price form open and writes nothing", async () => {
    settings = preferences({
      ...settings,
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    render();
    click('[data-action="desk-pick"][data-code="boots5"]');
    render();
    click('[data-action="desk-ledger-new"]');
    render();
    click('[data-action="desk-ledger-add"]');
    await flush();
    render();
    const id = onLedger.mock.calls[0][0].changed[0].id;
    click(
      `[data-action="desk-ledger-move"][data-type="list"][data-id="${id}"]`,
    );
    render();
    click('[data-action="desk-ledger-confirm"]'); // the price field is empty
    await flush();
    render();
    expect(onLedger).toHaveBeenCalledTimes(1); // the craft only
    expect(el().textContent).toContain("Ledger: a listing needs its price");
    expect(el().querySelector('[data-field="pending-price"]')).not.toBeNull();
    expect(state.ledger.entries[0].state).toBe("crafted");
    expect(el().textContent).not.toContain("listed at");
    type("pending-price", "12");
    click('[data-action="desk-ledger-confirm"]');
    await flush();
    render();
    expect(onLedger).toHaveBeenCalledTimes(2);
    expect(state.ledger.entries[0]).toMatchObject({
      state: "listed",
      listing: { price: 12 },
    });
    expect(el().textContent).toContain("Listed at 12.000 g");
  });
  it("says when the latest sales read failed: the last good read stays, labelled as such, and a cell with no read says so", () => {
    settings = preferences({
      ...settings,
      craftRecipes: {
        boots5: { scraps: 10, steel: 2 },
        helmet5: { scraps: 10, steel: 2 },
      },
    });
    state.salesByCode = {
      boots5: {
        code: "boots5",
        at: iso(600e3),
        complete: true,
        fills: fills("boots5", [10, 11, 12, 13, 14]),
      },
    };
    state.salesErrors = {
      boots5: "the API answered 503",
      helmet5: "the API answered 503",
    };
    render();
    click('[data-action="desk-pick"][data-code="boots5"]');
    render();
    const cell = (code) =>
      el().querySelector(`[data-action="desk-pick"][data-code="${code}"]`);
    expect(cell("boots5").textContent).toBe("+126% ⚠");
    expect(cell("boots5").title).toContain(
      "last read failed (the API answered 503); showing the last good read",
    );
    expect(cell("helmet5").textContent).toBe("read failed");
    expect(cell("helmet5").title).toContain(
      "sales read failed: the API answered 503",
    );
    const text = el().textContent;
    expect(text).toContain("Evidence: 5 comparable fills");
    expect(text).toContain(
      "last read failed (the API answered 503): the last good read is shown",
    );
    // the next read succeeds: the labels go, the numbers stay
    state.salesErrors = {};
    render();
    expect(cell("boots5").textContent).toBe("+126%");
    expect(el().textContent).not.toContain("last read failed");
  });
  it("labels a failed read on an item whose cached sample is too small, in the EV line and the listing guidance", () => {
    settings = preferences({
      ...settings,
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    state.salesByCode = {
      boots5: {
        code: "boots5",
        at: iso(600e3),
        complete: true,
        fills: fills("boots5", [10, 11, 12]),
      },
    };
    state.salesErrors = { boots5: "the API answered 503" };
    render();
    click('[data-action="desk-pick"][data-code="boots5"]');
    render();
    expect(
      el().querySelector('[data-action="desk-pick"][data-code="boots5"]')
        .textContent,
    ).toBe("3/5 fills ⚠");
    const text = el().textContent;
    expect(text).toContain(
      "no scenario yet · last read failed (the API answered 503): the last good read is shown",
    );
    expect(text).toContain("no outcomes · 3 of 5 comparable fills");
    expect(text).toContain(
      "last read failed (the API answered 503); showing the last good read",
    );
  });
  it("keeps the craft form open and says the ledger is full when the worker could not hold the entry", async () => {
    settings = preferences({
      ...settings,
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    render();
    click('[data-action="desk-pick"][data-code="boots5"]');
    render();
    click('[data-action="desk-ledger-new"]');
    render();
    onLedger.mockImplementationOnce(async (ops) => ({
      ledger: { ...state.ledger, revision: 2 },
      merged: false,
      dropped: [],
      conflicts: [],
      capped: ops.changed.map((e) => e.id),
    }));
    click('[data-action="desk-ledger-add"]');
    await flush();
    render();
    expect(el().querySelector(".lens-form")).not.toBeNull(); // the form stays for another try once there is room
    expect(el().textContent).toContain(
      "Ledger: the entry was not kept, the ledger is full (500 entries); export it and delete old entries",
    );
    expect(el().textContent).not.toContain("Recorded");
  });
  it("keeps a pasted import open and says how many entries did not fit when the ledger is full", async () => {
    render();
    click('[data-action="desk-import-toggle"]');
    render();
    const entry = (id) => ({
      id,
      createdAt: iso(),
      updatedAt: iso(),
      code: "boots5",
      inputs: { scraps: 1, steel: 0, scrapPrice: 0.2 },
      state: "crafted",
    });
    const text = JSON.stringify({
      kind: "craft-ledger",
      entries: [entry("imp-0001"), entry("imp-0002"), entry("imp-0003")],
    });
    type("import-text", text);
    // the worker: one fits, the ledger is full for the other two
    onLedger.mockImplementationOnce(async (ops) => {
      state.ledger = {
        ...state.ledger,
        revision: 2,
        entries: ops.changed.slice(0, 1),
      };
      return {
        ledger: state.ledger,
        merged: false,
        dropped: [],
        conflicts: [],
        capped: ops.changed.slice(1).map((e) => e.id),
      };
    });
    click('[data-action="desk-import-paste"]');
    await flush();
    render();
    expect(onLedger.mock.calls.at(-1)[0].changed).toHaveLength(3); // every entry the file adds travels
    expect(el().textContent).toContain(
      "Imported: 3 added, 0 updated, 0 skipped · 2 not applied: not kept: the ledger is full (500 entries), export it and delete old entries",
    );
    const textarea = el().querySelector('[data-field="import-text"]');
    expect(textarea).not.toBeNull(); // the import stays for another try once there is room
    expect(textarea.value).toBe(text);
  });
  it("keeps the craft form and says so when the worker refused the write as too old", async () => {
    settings = preferences({
      ...settings,
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    render();
    click('[data-action="desk-pick"][data-code="boots5"]');
    render();
    click('[data-action="desk-ledger-new"]');
    render();
    onLedger.mockImplementationOnce(async () => ({
      error: "stale",
      message:
        "this tab's copy of the ledger was too old to apply safely; it has been reloaded, try again",
      ledger: { ...state.ledger, revision: 2000 },
    }));
    click('[data-action="desk-ledger-add"]');
    await flush();
    render();
    expect(el().querySelector(".lens-form")).not.toBeNull();
    expect(el().textContent).toContain(
      "Ledger: this tab's copy of the ledger was too old to apply safely; it has been reloaded, try again",
    );
    expect(el().textContent).not.toContain("Recorded");
  });
  it("counts how many comparable fills would have beaten the cost, instead of a 0% or 100% claim from the median alone", () => {
    settings = preferences({
      ...settings,
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    // cost 5.300 g; the seller keeps the listing, so fills at 4, 5, 6, 7 and 8 are what sellers got: three of five beat it, the median (6) does
    state.salesByCode = {
      boots5: {
        code: "boots5",
        at: iso(),
        complete: true,
        fills: fills("boots5", [4, 5, 6, 7, 8]),
      },
    };
    render();
    click('[data-action="desk-pick"][data-code="boots5"]');
    render();
    const text = el().textContent;
    expect(text).toContain("Expected proceeds per craft6.000 g");
    expect(text).toContain(
      "3 of the 5 comparable fills would have beaten the cost (fill prices taken as the sellers' listings)",
    );
    expect(text).not.toContain("% of outcomes beat the cost");
  });
  it("keeps a setting typed while an earlier save of the same field was still pending", async () => {
    render();
    const apply = save.getMockImplementation();
    let confirm;
    save.mockImplementationOnce(
      (patch) =>
        new Promise((resolve) => {
          confirm = () => resolve(apply(patch));
        }),
    );
    type("batch", "4", "change");
    type("batch", "40"); // typed while the save of 4 is pending, its change event not yet fired
    confirm();
    await flush();
    render();
    expect(settings.craftBatch).toBe(4);
    expect(el().querySelector('[data-field="batch"]').value).toBe("40");
    type("batch", "40", "change");
    await flush();
    render();
    expect(settings.craftBatch).toBe(40);
    expect(el().querySelector('[data-field="batch"]').value).toBe("40");
    settings = preferences({ ...settings, craftBatch: 7 }); // changed in the popup: no longer shadowed
    render();
    expect(el().querySelector('[data-field="batch"]').value).toBe("7");
  });
  it("prices the random craft of a tier at half the steel over the six slots' estimates, and says how many slots are covered", () => {
    const legendary = [
      "tank",
      "helmet5",
      "chest5",
      "gloves5",
      "pants5",
      "boots5",
    ];
    const medians = {
      tank: 200,
      helmet5: 100,
      chest5: 100,
      gloves5: 100,
      pants5: 100,
      boots5: 150,
    };
    state.salesByCode = Object.fromEntries(
      legendary.map((c) => [
        c,
        {
          code: c,
          at: iso(),
          complete: true,
          fills: fills(c, Array(5).fill(medians[c])),
        },
      ]),
    );
    render();
    const randomCell = () =>
      [...el().querySelectorAll(".lens-matrix tbody tr")]
        .find((r) => r.textContent.startsWith("legendary"))
        .querySelector("td.lens-random");
    // cost 486 × 0.21 + 16 × 1.6 = 127.66 g; EV 0.3 × 200 + 0.14 × (100 + 100 + 100 + 100 + 150) = 137 g; ROI +7.3%
    expect(randomCell().textContent).toBe("+7%");
    expect(randomCell().title).toContain("486 scraps + 16 steel");
    expect(randomCell().title).toContain("6 of 6 slots have a sales estimate");
    expect(randomCell().title).toContain("expected profit +9.340 g per craft");
    expect(el().querySelectorAll(".lens-matrix td button")).toHaveLength(36); // the random cell is no pick
    expect(el().querySelectorAll("td.lens-random")).toHaveLength(6);
    // The common tier has no fills: the cell says how many slots are covered instead of guessing.
    expect(
      [...el().querySelectorAll(".lens-matrix tbody tr")]
        .find((r) => r.textContent.startsWith("common"))
        .querySelector("td.lens-random").textContent,
    ).toBe("0/6 slots");
    click('[data-action="desk-pick"][data-code="boots5"]');
    render();
    expect(el().textContent).toContain(
      "Random craft of this tier instead: 486 scraps + 16 steel = 127.660 g; the game picks the slot: 30% weapon, 14% each armour slot. Expected 137.000 g, ROI +7.3% over the six slots' estimates.",
    );
    // An override of one cell describes a chosen-slot craft; the random craft keeps the game's table.
    settings = preferences({
      ...settings,
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    render();
    expect(randomCell().textContent).toBe("+7%");
    delete state.salesByCode.boots5;
    render();
    expect(randomCell().textContent).toBe("5/6 slots");
    expect(el().textContent).toContain(
      "EV unavailable: 5 of 6 slots have a sales estimate",
    );
  });
});
