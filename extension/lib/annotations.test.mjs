// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createEquipment, valueOf, rowSkills } from "./equipment.mjs";
import { rowsContainer } from "./dom.mjs";
import { DEFAULTS } from "./settings.mjs";

// One (or more) offer rows of a common knife on the equipment market,
// filtered to the knife, with the game's visible lines (stat, durability,
// price, BUY).
const NOW = Date.parse("2026-10-03T12:00:00Z");
const iso = (msAgo = 0) => new Date(NOW - msAgo).toISOString();
const fill = (price, hoursAgo, skills = null, code = "knife") => ({
  price,
  at: iso(hoursAgo * 3600e3),
  state: 100,
  code,
  skills,
});
const sales = (fills, extra = {}) => ({
  code: "knife",
  at: iso(),
  complete: true,
  fills,
  ...extra,
});
let equipment, settings, state, row, rescan, body;
let lines = ["Item", "270", "100%", "Seller", "1", "BUY"];

function offerHtml(id, alt = "knife") {
  return `<article id="${id}" class="offer"><div style="background:rgb(12,12,12);border:1px solid rgb(28,46,49)"><img alt="${alt}"></div><button class="buy">BUY</button></article>`;
}
function fakeText(article) {
  Object.defineProperty(article, "innerText", {
    configurable: true,
    get: () =>
      [...lines, article.querySelector(".ss-verdict")?.textContent ?? ""].join(
        "\n",
      ),
  });
}
function mount(selected = "knife", count = 1) {
  document.body.innerHTML = `<main><div id="tax"><span>Market tax 5%</span></div><div><div id="item-code-selector-${selected}" style="z-index:1;border-color:rgb(28,46,49)"></div><div id="item-code-selector-jet" style="border-color:rgb(57,15,16)"></div></div><div id="offers">${Array.from(
    { length: count },
    (_, i) => offerHtml(i ? `offer${i + 1}` : "offer"),
  ).join("")}</div><div id="body"></div></main>`;
  for (const article of document.querySelectorAll("article")) fakeText(article);
  row = document.getElementById("offer");
  body = document.getElementById("body");
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  window.history.replaceState({}, "", "/market/equipments?item=knife");
  lines = ["Item", "270", "100%", "Seller", "1", "BUY"];
  mount();
  settings = { ...DEFAULTS };
  rescan = vi.fn();
  equipment = createEquipment({
    settings: () => settings,
    requestSales: vi.fn(),
    rescan,
  });
  state = {
    book: { at: iso(), bids: [{ price: 0.2, quantity: 2000 }] },
    error: null,
    salesErrors: {},
    salesReading: null,
    busy: false,
    setup: null,
    salesByCode: {},
    avg: null,
  };
});
afterEach(() => {
  equipment.clear();
  document.body.innerHTML = "";
  vi.useRealTimers();
});
const annotation = (r = row) => r.querySelector(":scope > .ss-verdict");
const details = (r = row) =>
  annotation(r).querySelector("[data-action='details']");
const tag = (r = row) => annotation(r).querySelector(".lens-tag").textContent;

describe("the value of a row", () => {
  it("keys an armour roll by the slot's stat and a weapon by its attack (the crit is not read)", () => {
    expect(rowSkills("boots5", { stat: 38 })).toEqual({ dodge: 38 });
    expect(rowSkills("helmet6", { stat: 140 })).toEqual({
      criticalDamages: 140,
    });
    expect(rowSkills("jet", { stat: 262 })).toEqual({ attack: 262 });
    expect(rowSkills("jet", { stat: null })).toBeNull();
    expect(rowSkills(null, { stat: 1 })).toBeNull();
  });
  it("prefers same-roll fills, then the band, then the item, and falls back to the game's average", () => {
    const f = (price, dodge) => fill(price, 1, { dodge }, "boots5");
    const roll = valueOf({
      code: "boots5",
      stats: { stat: 38 },
      sales: {
        code: "boots5",
        fills: [f(100, 38), f(110, 38), f(90, 38), f(105, 38), f(95, 38)],
      },
      avg: 50,
      now: NOW,
    });
    expect(roll).toMatchObject({
      amount: 100,
      source: "fills",
      basis: "roll",
      n: 5,
    });
    const band = valueOf({
      code: "boots5",
      stats: { stat: 38 },
      sales: {
        code: "boots5",
        fills: [f(100, 37), f(110, 38), f(90, 37), f(105, 38), f(95, 37)],
      },
      avg: 50,
      now: NOW,
    });
    expect(band).toMatchObject({ basis: "band", n: 5, amount: 100 });
    const item = valueOf({
      code: "boots5",
      stats: { stat: 38 },
      sales: {
        code: "boots5",
        fills: [f(100, 31), f(110, 32), f(90, 33), f(105, 34), f(95, 35)],
      },
      avg: 50,
      now: NOW,
    });
    expect(item).toMatchObject({ basis: "item", n: 5, amount: 100 });
    const avg = valueOf({
      code: "boots5",
      stats: { stat: 38 },
      sales: { code: "boots5", fills: [f(100, 38)] },
      avg: 50,
      avgAt: iso(),
      now: NOW,
    });
    expect(avg).toMatchObject({ amount: 50, source: "avg", label: "game avg" });
    expect(
      valueOf({ code: "boots5", stats: {}, sales: null, avg: 0, now: NOW }),
    ).toBeNull();
    expect(
      valueOf({
        code: "boots5",
        stats: {},
        sales: null,
        avg: 50,
        avgAt: iso(2 * 3600e3),
        now: NOW,
      }).label,
    ).toBe("game avg (stale)");
  });
  it("ignores fills older than 72 h", () => {
    const old = [1, 1.1, 0.9, 1.2, 1.05].map((p, i) => fill(p, 73 + i));
    expect(
      valueOf({
        code: "knife",
        stats: { stat: 270 },
        sales: sales(old),
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("row annotation", () => {
  it("shows the scrap profit, the ROI and the SNIPE tag next to the native price and keeps BUY untouched", () => {
    equipment.render(state);
    const a = annotation();
    expect(tag()).toBe("SNIPE");
    expect(a.textContent).toContain("+0.200 g");
    expect(a.textContent).toContain("ROI +20.0%");
    expect(row.dataset.scrapSniper).toBe("hit");
    expect(row.querySelector(".buy").disabled).toBe(false);
    expect(row.querySelector(".buy").textContent).toBe("BUY");
    expect(a.querySelector(".lens-details")).toBeNull();
    expect(details().getAttribute("aria-expanded")).toBe("false");
  });
  it("tells the value states apart: averages still loading, none, the game's average, reading sales, failed, too few, same-roll fills", () => {
    equipment.render(state);
    expect(annotation().textContent).toContain("value · reading averages…");
    state.avg = { at: iso(), values: {}, times: {} };
    equipment.render(state);
    expect(annotation().textContent).toContain("value · no average yet");
    state.avg = { at: iso(), values: { knife: 1.5 }, times: { knife: iso() } };
    equipment.render(state);
    expect(annotation().textContent).toContain("~1.500 g");
    expect(annotation().textContent).toContain("value · game avg");
    state.salesReading = "knife";
    state.avg = null;
    equipment.render(state);
    expect(annotation().textContent).toContain("value · reading sales…");
    state.salesReading = null;
    state.salesErrors = { knife: "the API answered 503" };
    equipment.render(state);
    expect(annotation().textContent).toContain("value · sales read failed");
    state.salesErrors = {};
    state.salesByCode = {
      knife: sales([fill(1, 1), fill(1.1, 2), fill(0.9, 3), fill(1.2, 4)]),
    };
    equipment.render(state);
    expect(annotation().textContent).toContain("value · 4 of 5 fills in 72 h");
    state.salesByCode.knife = sales(
      [...state.salesByCode.knife.fills, fill(1.05, 5)],
      { at: iso(1) },
    );
    equipment.render(state);
    expect(annotation().textContent).toContain("~1.050 g");
    expect(annotation().textContent).toContain("value · 5 fills, any roll");
    // an armour roll read off the row is matched to the fills' rolls
    mount("boots5");
    lines = ["Item", "38", "100%", "Seller", "100", "BUY"];
    row.querySelector("img").setAttribute("alt", "boots5");
    row.querySelector("div").style.borderColor = "rgb(43,43,18)";
    document.getElementById("item-code-selector-boots5").style.borderColor =
      "rgb(43,43,18)";
    state.salesByCode = {
      boots5: {
        code: "boots5",
        at: iso(),
        complete: true,
        fills: [100, 110, 90, 105, 95].map((p, i) =>
          fill(p, i + 1, { dodge: 38 }, "boots5"),
        ),
      },
    };
    state.book = { at: iso(), bids: [{ price: 0.2, quantity: 2000 }] };
    equipment.render(state);
    expect(annotation().textContent).toContain("value · 5 same-roll fills");
    expect(annotation().textContent).toContain("~100.000 g");
  });
  it("tags FLIP when the value beats the price by the threshold and the scraps do not, PASS otherwise", () => {
    state.book = { at: iso(), bids: [{ price: 0.1, quantity: 2000 }] }; // 6 scraps = 0.6 g against a 1 g price
    state.avg = { at: iso(), values: { knife: 1.5 }, times: { knife: iso() } };
    equipment.render(state);
    expect(tag()).toBe("FLIP");
    expect(row.dataset.scrapSniper).toBe("flip");
    expect(annotation().textContent).toContain("−0.400 g");
    settings.flipPct = 60; // 1.5 is 50% above 1
    equipment.render(state);
    expect(tag()).toBe("PASS");
    expect(row.dataset.scrapSniper).toBe("miss");
    settings.flipPct = 50; // exactly at the bar counts
    equipment.render(state);
    expect(tag()).toBe("FLIP");
    // a scrap hit outranks the flip
    state.book = { at: iso(), bids: [{ price: 0.2, quantity: 2000 }] };
    equipment.render(state);
    expect(tag()).toBe("SNIPE");
    // a near miss on the scraps with a negative threshold, no flip
    state.book = { at: iso(), bids: [{ price: 0.16, quantity: 2000 }] };
    state.avg = null;
    settings.minMarginPct = -10;
    equipment.render(state);
    expect(tag()).toBe("NEAR MISS");
    expect(row.dataset.scrapSniper).toBe("near");
  });
  it("tags FLIP without a scrap quote when the value is known, NO QUOTE otherwise", () => {
    row.querySelector("div").style.borderColor = "rgb(1,2,3)"; // off-palette: rarity unreadable by border
    row.querySelector("img").setAttribute("alt", "mystery");
    equipment.render(state);
    expect(tag()).toBe("NO QUOTE");
    expect(annotation().textContent).toContain("scrap · rarity unreadable");
    expect(annotation().textContent).toContain("value · item unknown");
  });
  it("opens and closes Details from a real button, keeps focus across re-renders, and does not reach the row", () => {
    state.salesByCode = {
      knife: sales(
        [1, 1.1, 0.9, 1.2, 1.05, 1.3, 0.95, 1.15].map((p, i) => fill(p, i + 1)),
      ),
    };
    const rowClicks = vi.fn();
    row.addEventListener("click", rowClicks);
    equipment.render(state);
    details().focus();
    details().click();
    expect(rescan).toHaveBeenCalledTimes(1);
    expect(rowClicks).not.toHaveBeenCalled();
    equipment.render(state);
    expect(details().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(details());
    const region = annotation().querySelector(".lens-details");
    expect(region.getAttribute("role")).toBe("region");
    expect(region.textContent).toContain("Dismantle: 6 scraps");
    expect(region.textContent).toContain("Value 1.075 g · 8 fills, any roll");
    expect(region.textContent).toContain("value − price = +0.075 g");
    expect(region.textContent).toContain("8 fills of common knife in 72 h");
    expect(region.textContent).toContain("percentile of those fills");
    expect(region.textContent).toContain("Durability 100% · stat 270");
    expect(region.textContent).toContain("fresh");
    region.click(); // selecting or clicking the Details text is ours, not the row's
    expect(rowClicks).not.toHaveBeenCalled();
    annotation().querySelector(".lens-kv").click(); // the profit text is the row's: the click falls through
    expect(rowClicks).toHaveBeenCalledTimes(1);
    annotation().click(); // so is the annotation's own box
    expect(rowClicks).toHaveBeenCalledTimes(2);
    details().click();
    equipment.render(state);
    expect(annotation().querySelector(".lens-details")).toBeNull();
    expect(details().getAttribute("aria-expanded")).toBe("false");
  });
  it("explains a value taken from the game's average in Details", () => {
    state.avg = { at: iso(), values: { knife: 1.5 }, times: { knife: iso() } };
    equipment.render(state);
    details().click();
    equipment.render(state);
    const text = annotation().querySelector(".lens-details").textContent;
    expect(text).toContain("Value 1.500 g · game avg");
    expect(text).toContain("mean of recent sales of common knife, any roll");
  });
  it("keeps Details per row when two listings look identical", () => {
    mount("knife", 2);
    const second = document.getElementById("offer2");
    equipment.render(state);
    details().click();
    equipment.render(state);
    expect(details().getAttribute("aria-expanded")).toBe("true");
    expect(details(second).getAttribute("aria-expanded")).toBe("false");
    expect(annotation(second).querySelector(".lens-details")).toBeNull();
  });
  it("lets fills age out of the window as time passes", () => {
    state.salesByCode = {
      knife: sales([1, 1.1, 0.9, 1.2, 1.05].map((p, i) => fill(p, 60 + i))),
    };
    equipment.render(state);
    expect(annotation().textContent).toContain("value · 5 fills, any roll");
    vi.setSystemTime(new Date(NOW + 10 * 3600e3));
    equipment.render(state);
    expect(annotation().textContent).toContain("value · 3 of 5 fills in 72 h"); // 70, 71 and 72 h ago; the 72 h edge counts
  });
});

describe("states, pulse and the Market section", () => {
  it("counts snipes, flips and rows for the pulse; a failed sales read changes nothing there", () => {
    mount("knife", 3);
    state.avg = { at: iso(), values: { knife: 1.5 }, times: { knife: iso() } };
    equipment.render(state);
    expect(equipment.pulse()).toContain("<b>3</b> snipes");
    expect(equipment.pulse()).toContain("<b>0</b> flips");
    expect(equipment.pulse()).toContain("3 rows");
    state.book = { at: iso(), bids: [{ price: 0.1, quantity: 2000 }] };
    state.salesErrors = { knife: "the API answered 503" };
    const r = equipment.render(state);
    expect(r).toMatchObject({ hits: 0, flips: 3, scanned: 3, readable: 3 });
    expect(equipment.pulse()).toContain("<b>3</b> flips");
  });
  it("shows reading, failed and stale quote states without tags", () => {
    state.book = null;
    state.busy = true;
    equipment.render(state);
    expect(row.dataset.scrapSniper).toBe("loading");
    expect(tag()).toBe("READING");
    state.busy = false;
    state.error = "could not reach the API";
    equipment.render(state);
    expect(row.dataset.scrapSniper).toBe("error");
    expect(annotation().textContent).toContain("quote unavailable");
    state.book = { at: iso(3600e3), bids: [{ price: 0.2, quantity: 2000 }] };
    equipment.render(state);
    expect(row.dataset.scrapSniper).toBe("stale");
    expect(tag()).toBe("STALE");
    expect(equipment.pulse()).toContain("<b>0</b> snipes");
  });
  it("removes annotations while the key is missing", () => {
    equipment.render(state);
    expect(annotation()).not.toBeNull();
    state.setup = "Add your WarEra API key in extension settings.";
    equipment.render(state);
    expect(annotation()).toBeNull();
    expect(row.dataset.scrapSniper).toBeUndefined();
  });
  it("does not rewrite an unchanged annotation and reads a row's layout text once", () => {
    mount("knife", 2);
    equipment.render(state);
    const written = equipment.metrics.rowsWritten;
    const reads = equipment.metrics.innerTextReads;
    const node = annotation().firstChild;
    equipment.render(state);
    equipment.render(state);
    expect(equipment.metrics.rowsWritten).toBe(written);
    expect(equipment.metrics.innerTextReads).toBe(reads);
    expect(annotation().firstChild).toBe(node);
    expect(equipment.metrics.scopedScans).toBeGreaterThan(0);
  });
  it("scopes later scans to a list container only when two rows or more agree on one", () => {
    equipment.render(state);
    expect(equipment.metrics.scopedScans).toBe(0); // one row: every scan is a full scan
    equipment.render(state);
    expect(equipment.metrics.scopedScans).toBe(0);
    expect(rowsContainer([{ row }])).toBeNull();
    mount("knife", 2);
    const rows = [...document.querySelectorAll("article")].map((r) => ({
      row: r,
    }));
    expect(rowsContainer(rows)).toBe(document.getElementById("offers"));
  });
  it("renders the Market section: scrap floors, the selected item's fills, the legend", () => {
    equipment.render(state);
    equipment.renderMarket(body, state);
    expect(body.querySelectorAll(".lens-floor")).toHaveLength(6);
    expect(
      body.querySelector('.lens-floor[data-rarity="mythic"]').textContent,
    ).toContain("291.600");
    expect(body.textContent).toContain(
      "Reading the recent fills of common knife",
    );
    state.salesByCode = {
      knife: sales([1, 1.1, 0.9, 1.2, 1.05].map((p, i) => fill(p, i + 1))),
    };
    equipment.render(state);
    equipment.renderMarket(body, state);
    expect(body.textContent).toContain("5 fills in 72 h");
    expect(body.textContent).toContain("median 1.050 g");
    expect(body.textContent).toContain("SNIPE:");
    state.salesErrors = { knife: "the API answered 503" };
    equipment.renderMarket(body, state);
    expect(body.textContent).toContain("last read failed");
    state.error = "could not reach the API";
    equipment.renderMarket(body, state);
    expect(body.textContent).toContain(
      "could not reach the API · showing the last quote",
    );
    mount("jet");
    equipment.render(state);
    equipment.renderMarket(body, state);
    expect(body.textContent).toContain(
      "Reading the recent fills of mythic jet",
    );
  });
});
