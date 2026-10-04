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
  it("works a craft through once its recipe is saved: cost, buy-now against bids, EV over outcomes, ceilings on the tick", async () => {
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
      craftRecipeOps: { set: { boots5: { scraps: 10, steel: 2 } } },
    });
    await flush();
    render();
    const text = () => el().textContent;
    expect(text()).toContain("5.300 g"); // 10 × 0.21 + 2 × 1.6
    expect(text()).toContain("Buy now at the asks");
    expect(text()).toContain("Place bids at the best bid");
    expect(text()).toContain("5.000 g"); // 10 × 0.2 + 2 × 1.5
    expect(text()).toContain("saves 0.300 g against buying now if it does");
    expect(text()).toContain("unavailable");
    expect(text()).toContain("no recent fills read for this item");
    expect(text()).toContain("Break-even listing 5.579 g"); // 5.3 / 0.95, up to the tick
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
    expect(text()).toContain("best legendary boots +115%");
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
    expect(onLedger).toHaveBeenLastCalledWith({ changed: [], removed: [id] });
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
    expect(cell()).toBe("+115%");
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
    expect(el().textContent).toContain("Recipe for legendary boots removed");
    expect(
      el().querySelector('[data-action="desk-pick"][data-code="boots5"]')
        .textContent,
    ).toBe("no recipe");
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
});
