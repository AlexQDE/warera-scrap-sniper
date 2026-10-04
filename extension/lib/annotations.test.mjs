// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createEquipment } from "./equipment.mjs";
import { DEFAULTS } from "./settings.mjs";

// One offer row of a common knife on the equipment market, filtered to the
// knife, with the game's visible lines (stat, durability, price, BUY).
const NOW = Date.parse("2026-10-03T12:00:00Z");
const iso = (msAgo = 0) => new Date(NOW - msAgo).toISOString();
const fill = (price, hoursAgo, state = 100) => ({
  price,
  at: iso(hoursAgo * 3600e3),
  state,
  code: "knife",
});
let equipment, settings, state, row, rescan;
let lines = ["Item", "270", "100%", "Seller", "1", "BUY"];

function mount(selected = "knife") {
  document.body.innerHTML = `<main><div id="tax"><span>Market tax 5%</span></div><div><div id="item-code-selector-${selected}" style="z-index:1;border-color:rgb(28,46,49)"></div><div id="item-code-selector-jet" style="border-color:rgb(57,15,16)"></div></div><div id="offers"><article id="offer"><div style="background:rgb(12,12,12);border:1px solid rgb(28,46,49)"><img alt="knife"></div><button id="buy">BUY</button></article></div></main>`;
  row = document.getElementById("offer");
  Object.defineProperty(row, "innerText", {
    configurable: true,
    get: () =>
      [...lines, row.querySelector(".ss-verdict")?.textContent ?? ""].join(
        "\n",
      ),
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  window.history.replaceState({}, "", "/market/equipments?item=knife");
  lines = ["Item", "270", "100%", "Seller", "1", "BUY"];
  mount();
  settings = { ...DEFAULTS, collapsed: true };
  rescan = vi.fn();
  equipment = createEquipment({
    settings: () => settings,
    save: (p) => Object.assign(settings, p),
    refresh: vi.fn(),
    requestSales: vi.fn(),
    rescan,
  });
  state = {
    book: { at: iso(), bids: [{ price: 0.2, quantity: 2000 }] },
    error: null,
    salesError: null,
    salesBusy: false,
    busy: false,
    setup: null,
    salesByCode: {},
    action: vi.fn(),
  };
});
afterEach(() => {
  equipment.clear();
  document.body.innerHTML = "";
  vi.useRealTimers();
});
const annotation = () => row.querySelector(":scope > .ss-verdict");
const details = () => annotation().querySelector("[data-action='details']");

describe("compact annotation", () => {
  it("shows scrap profit and ROI next to the native price and keeps BUY untouched", () => {
    equipment.render(state);
    const a = annotation();
    expect(a.textContent).toContain("SNIPE");
    expect(a.textContent).toContain("+0.200 g");
    expect(a.textContent).toContain("ROI +20.0%");
    expect(document.getElementById("buy").disabled).toBe(false);
    expect(document.getElementById("buy").textContent).toBe("BUY");
    expect(a.querySelector(".lens-details")).toBeNull();
    expect(details().getAttribute("aria-expanded")).toBe("false");
  });
  it("tells the resale states apart: select the item, reading, failed, too few, enough", () => {
    mount("jet");
    equipment.render(state);
    expect(annotation().textContent).toContain("resale · select this item");
    mount("knife");
    state.salesBusy = true;
    equipment.render(state);
    expect(annotation().textContent).toContain("resale · reading sales");
    state.salesBusy = false;
    state.salesError = "the API answered 503";
    equipment.render(state);
    expect(annotation().textContent).toContain("resale · sales read failed");
    state.salesError = null;
    state.salesByCode = {
      knife: {
        code: "knife",
        at: iso(),
        complete: true,
        fills: [fill(1, 1), fill(1.1, 2), fill(0.9, 3), fill(1.2, 4)],
      },
    };
    equipment.render(state);
    expect(annotation().textContent).toContain("resale · 4 of 5 fills");
    state.salesByCode.knife = {
      ...state.salesByCode.knife,
      at: iso(1),
      fills: [...state.salesByCode.knife.fills, fill(1.05, 5)],
    };
    equipment.render(state);
    expect(annotation().textContent).toContain("~1.050 g");
    expect(annotation().textContent).toContain("resale · 5 fills");
  });
  it("opens and closes Details from a real button, keeps focus across re-renders, and does not reach the row", () => {
    state.salesByCode = {
      knife: {
        code: "knife",
        at: iso(),
        complete: true,
        fills: [1, 1.1, 0.9, 1.2, 1.05, 1.3, 0.95, 1.15].map((p, i) =>
          fill(p, i + 1),
        ),
      },
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
    expect(region.textContent).toContain(
      "Resale evidence: median 1.075 g of 8 comparable fills",
    );
    expect(region.textContent).toContain("p25");
    expect(region.textContent).toContain("Dismantle: 6 scraps");
    expect(region.textContent).toContain("Durability 100% · stat 270");
    expect(region.textContent).toContain(
      "stat rank needs 8 listed peers (0 now)",
    );
    expect(region.textContent).toContain("fills/day");
    details().click();
    equipment.render(state);
    expect(annotation().querySelector(".lens-details")).toBeNull();
    expect(details().getAttribute("aria-expanded")).toBe("false");
  });
  it("withholds quartiles and the price rank below eight fills even with Details open", () => {
    state.salesByCode = {
      knife: {
        code: "knife",
        at: iso(),
        complete: false,
        fills: [1, 1.1, 0.9, 1.2, 1.05, 1.3, 0.95].map((p, i) =>
          fill(p, i + 1),
        ),
      },
    };
    equipment.render(state);
    details().click();
    equipment.render(state);
    const text = annotation().querySelector(".lens-details").textContent;
    expect(text).toContain("of 7 comparable fills");
    expect(text).toContain("sample capped at five pages");
    expect(text).toContain("quartiles need 8 fills");
    expect(text).toContain("a price rank needs 8 fills");
  });
  it("compares durability only when the fills carry one", () => {
    const worn = [1, 1.1, 0.9, 1.2, 1.05].map((p, i) => fill(p, i + 1, 40));
    state.salesByCode = {
      knife: { code: "knife", at: iso(), complete: true, fills: worn },
    };
    equipment.render(state);
    expect(annotation().textContent).toContain("resale · 0 of 5 fills");
    state.salesByCode = {
      knife: {
        code: "knife",
        at: iso(1),
        complete: true,
        fills: worn.map((f) => ({ ...f, state: null })),
      },
    };
    equipment.render(state);
    expect(annotation().textContent).toContain("resale · 5 fills");
  });
});

describe("summary line and states", () => {
  it("keeps the readable-stat count when the sales read fails", () => {
    equipment.render(state);
    const bar = () => document.getElementById("scrap-sniper-bar").textContent;
    expect(bar()).toContain("1 readable stats");
    expect(bar()).toContain("1 snipes");
    state.salesError = "the API answered 503";
    equipment.render(state);
    expect(bar()).toContain("1 readable stats");
    expect(bar()).toContain("1 snipes");
    expect(bar()).toContain("Resale: sales read failed");
    expect(row.dataset.scrapSniper).toBe("hit");
    lines = ["Item", "Seller", "1", "BUY"];
    row.appendChild(document.createTextNode("·")); // a native text change, so the row is read again
    equipment.render(state);
    expect(bar()).toContain("0 readable stats");
    expect(row.dataset.scrapSniper).toBe("hit");
  });
  it("shows reading, failed and stale quote states without action labels", () => {
    state.book = null;
    state.busy = true;
    equipment.render(state);
    expect(row.dataset.scrapSniper).toBe("loading");
    expect(annotation().textContent).toContain("READING");
    expect(
      document.querySelector("#scrap-sniper-bar .lens-status").dataset.status,
    ).toBe("loading");
    state.busy = false;
    state.error = "could not reach the API";
    equipment.render(state);
    expect(row.dataset.scrapSniper).toBe("error");
    expect(annotation().textContent).toContain("Quote unavailable");
    expect(document.getElementById("scrap-sniper-bar").textContent).toContain(
      "could not reach the API",
    );
    state.book = { at: iso(3600e3), bids: [{ price: 0.2, quantity: 2000 }] };
    equipment.render(state);
    expect(row.dataset.scrapSniper).toBe("stale");
    expect(annotation().textContent).toContain("STALE");
    expect(document.getElementById("scrap-sniper-bar").textContent).toContain(
      "showing the last quote",
    );
  });
  it("does not rewrite an unchanged annotation and reads a row's layout text once", () => {
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
});
