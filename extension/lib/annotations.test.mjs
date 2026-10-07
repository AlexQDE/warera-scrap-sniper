// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createEquipment, valueOf } from "./equipment.mjs";
import { rowsContainer } from "./dom.mjs";
import { DEFAULTS } from "./settings.mjs";

// One (or more) offer rows of a common knife (attack 21–40, crit 1–5) on the
// equipment market, filtered to the knife, with the game's visible lines as
// read live on 2026-10-07: attack, crit, durability, seller, age, price, BUY.
const NOW = Date.parse("2026-10-03T12:00:00Z");
const iso = (msAgo = 0) => new Date(NOW - msAgo).toISOString();
const KNIFE = { attack: 30, criticalChance: 3 };
const fill = (price, hoursAgo, skills = KNIFE, code = "knife") => ({
  price,
  at: iso(hoursAgo * 3600e3),
  state: 100,
  code,
  skills,
  listedAt: iso((hoursAgo + 2) * 3600e3),
});
const sales = (fills, extra = {}) => ({
  code: "knife",
  at: iso(),
  complete: true,
  fills,
  ...extra,
});
let equipment, settings, state, row, rescan, body, requestSales;
let lines = ["Item", "30", "3%", "100%", "Seller", "1", "BUY"];

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
  lines = ["Item", "30", "3%", "100%", "Seller", "1", "BUY"];
  mount();
  settings = { ...DEFAULTS };
  rescan = vi.fn();
  requestSales = vi.fn();
  equipment = createEquipment({
    settings: () => settings,
    requestSales,
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
const stats = (list) => ({
  readable: true,
  durability: 100,
  stat: list[0],
  stats: list,
});

describe("the value of a row", () => {
  it("prices the piece by sales of its own stats, then similar stats, then the item unmatched, else the game's average", () => {
    const same = valueOf({
      code: "knife",
      stats: stats([30, 3]),
      sales: sales([fill(1, 1), fill(1.1, 2), fill(0.9, 3)]),
      avg: 5,
      now: NOW,
    });
    expect(same).toMatchObject({
      amount: 1,
      source: "fills",
      basis: "same",
      matched: true,
      n: 3,
      label: "3 sales · atk 30 · crit 3% · 7 d",
      low: 0.9,
      high: 1.1,
      sellsHours: 2,
    });
    const near = (price, i) =>
      fill(price, i, { attack: 30 + (i % 4), criticalChance: 4 }); // one crit point: a quarter of the crit range
    const similar = valueOf({
      code: "knife",
      stats: stats([30, 3]),
      sales: sales([
        near(2, 1),
        near(2.1, 2),
        near(1.9, 3),
        near(2.2, 4),
        near(2, 5),
      ]),
      avg: 5,
      now: NOW,
    });
    expect(similar).toMatchObject({
      basis: "similar",
      matched: true,
      n: 5,
      amount: 2,
      label: "5 sales · atk 30–33 · crit 4% · 7 d",
    });
    const far = (price, i) => fill(price, i, { attack: 40, criticalChance: 5 });
    const item = valueOf({
      code: "knife",
      stats: stats([30, 3]),
      sales: sales([far(3, 1), far(3, 2), far(3, 3), far(3, 4), far(3, 5)]),
      avg: 5,
      now: NOW,
    });
    expect(item).toMatchObject({
      basis: "item",
      matched: false,
      n: 5,
      amount: 3,
      label: "5 sales · any stats · 7 d",
    });
    const avg = valueOf({
      code: "knife",
      stats: stats([30, 3]),
      sales: sales([fill(1, 1)]),
      avg: 5,
      avgAt: iso(),
      now: NOW,
    });
    expect(avg).toMatchObject({
      amount: 5,
      source: "avg",
      matched: false,
      label: "game avg, any stats",
    });
    expect(
      valueOf({
        code: "knife",
        stats: stats([]),
        sales: null,
        avg: 0,
        now: NOW,
      }),
    ).toBeNull();
    expect(
      valueOf({
        code: "knife",
        stats: stats([]),
        sales: null,
        avg: 5,
        avgAt: iso(2 * 3600e3),
        now: NOW,
      }).label,
    ).toBe("game avg, any stats (stale)");
  });
  it("ignores sales older than 7 days", () => {
    const old = [1, 1.1, 0.9, 1.2, 1.05].map((p, i) => fill(p, 169 + i));
    expect(
      valueOf({
        code: "knife",
        stats: stats([30, 3]),
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
    expect(requestSales).toHaveBeenCalledWith("knife", ["knife"]);
  });
  it("tells the value states apart: averages still loading, none, the game's average, reading sales, failed, too few, sales of these stats", () => {
    equipment.render(state);
    expect(annotation().textContent).toContain("sells · reading averages…");
    state.avg = { at: iso(), values: {}, times: {} };
    equipment.render(state);
    expect(annotation().textContent).toContain("sells · no average yet");
    state.avg = { at: iso(), values: { knife: 1.5 }, times: { knife: iso() } };
    equipment.render(state);
    expect(annotation().textContent).toContain("~1.500 g");
    expect(annotation().textContent).toContain("sells · +50% · game avg");
    state.salesReading = "knife";
    state.avg = null;
    equipment.render(state);
    expect(annotation().textContent).toContain("sells · reading sales…");
    state.salesReading = null;
    state.salesErrors = { knife: "the API answered 503" };
    equipment.render(state);
    expect(annotation().textContent).toContain("sells · sales read failed");
    state.salesErrors = {};
    state.salesByCode = { knife: sales([fill(1, 1), fill(1.1, 2)]) };
    equipment.render(state);
    expect(annotation().textContent).toContain(
      "sells · 2 sales in 7 d, too few with these stats",
    );
    state.salesByCode.knife = sales(
      [...state.salesByCode.knife.fills, fill(1.05, 3)],
      { at: iso(1) },
    );
    equipment.render(state);
    expect(annotation().textContent).toContain("~1.050 g");
    expect(annotation().textContent).toContain(
      "sells · +5% · 3 sales same stats",
    );
    // an armour row prints its one stat as a percentage; the fills carry it as the slot's stat
    mount("boots5");
    lines = ["Item", "38%", "100%", "Seller", "100", "BUY"];
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
    equipment.render(state);
    expect(annotation().textContent).toContain(
      "sells · +0% · 5 sales same stats",
    );
    expect(annotation().textContent).toContain("~100.000 g");
  });
  it("tags FLIP only when sales of these stats beat the price by the threshold; the average and unmatched sales never do", () => {
    state.book = { at: iso(), bids: [{ price: 0.1, quantity: 2000 }] }; // 6 scraps = 0.6 g against a 1 g price
    state.avg = { at: iso(), values: { knife: 1.5 }, times: { knife: iso() } };
    equipment.render(state);
    expect(tag()).toBe("PASS"); // the game's average alone is no reason
    expect(annotation().textContent).toContain("~1.500 g");
    const far = (price, i) => fill(price, i, { attack: 40, criticalChance: 5 });
    state.salesByCode = {
      knife: sales([
        far(1.5, 1),
        far(1.5, 2),
        far(1.5, 3),
        far(1.5, 4),
        far(1.5, 5),
      ]),
    };
    equipment.render(state);
    expect(tag()).toBe("PASS"); // sales of other stats are no reason either
    expect(annotation().textContent).toContain("5 sales any stats");
    state.salesByCode = {
      knife: sales([fill(1.5, 1), fill(1.5, 2), fill(1.5, 3)]),
    };
    equipment.render(state);
    expect(tag()).toBe("FLIP");
    expect(row.dataset.scrapSniper).toBe("flip");
    expect(annotation().textContent).toContain("−0.400 g");
    expect(annotation().textContent).toContain(
      "sells · +50% · 3 sales same stats",
    );
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
    state.salesByCode = {};
    state.avg = null;
    settings.minMarginPct = -10;
    equipment.render(state);
    expect(tag()).toBe("NEAR MISS");
    expect(row.dataset.scrapSniper).toBe("near");
  });
  it("reads NO QUOTE with an unreadable rarity, and says the item is unknown", () => {
    row.querySelector("div").style.borderColor = "rgb(1,2,3)"; // off-palette: rarity unreadable by border
    row.querySelector("img").setAttribute("alt", "mystery");
    equipment.render(state);
    expect(tag()).toBe("NO QUOTE");
    expect(annotation().textContent).toContain("scrap · rarity unreadable");
    expect(annotation().textContent).toContain("sells · item unknown");
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
    expect(region.textContent).toContain(
      "This piece: atk 30 · crit 3% · 100% durability",
    );
    expect(region.textContent).toContain(
      "Sells for 1.075 g · 8 sales · atk 30 · crit 3% · 7 d · 0.900–1.300 · listed to sold in 2.0 h (median)",
    );
    expect(region.textContent).toContain("against this price +0.075 g (+7.5%)");
    expect(region.textContent).toContain(
      "8 sales of common knife in 7 d, any stats",
    );
    expect(region.textContent).toContain("percentile of the matched sales");
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
  it("explains a value taken from the game's average in Details, and that no tag rests on it", () => {
    state.avg = { at: iso(), values: { knife: 1.5 }, times: { knife: iso() } };
    equipment.render(state);
    details().click();
    equipment.render(state);
    const text = annotation().querySelector(".lens-details").textContent;
    expect(text).toContain("Sells for 1.500 g · game avg, any stats");
    expect(text).toContain(
      "mean of recent sales of common knife, any stats; no tag rests on it",
    );
  });
  it("names the other listings of the same stats on the page and the cheapest of them", () => {
    mount("knife", 3);
    equipment.render(state);
    details().click();
    equipment.render(state);
    const text = annotation().querySelector(".lens-details").textContent;
    expect(text).toContain(
      "Listed now with these stats: 2 others from 1.000 g",
    );
    expect(text).not.toContain("under the cheapest");
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
  it("lets sales age out of the 7-day window as time passes", () => {
    state.salesByCode = {
      knife: sales([1, 1.1, 0.9].map((p, i) => fill(p, 165 + i))),
    };
    equipment.render(state);
    expect(annotation().textContent).toContain("3 sales same stats");
    vi.setSystemTime(new Date(NOW + 2 * 3600e3));
    equipment.render(state);
    expect(annotation().textContent).toContain(
      "sells · 2 sales in 7 d, too few with these stats",
    );
  });
});

describe("states, pulse and the Market section", () => {
  it("counts snipes, flips and rows for the pulse; a failed sales read changes nothing there", () => {
    mount("knife", 3);
    state.salesByCode = {
      knife: sales([fill(1.5, 1), fill(1.5, 2), fill(1.5, 3)]),
    };
    equipment.render(state);
    expect(equipment.pulse()).toContain("<b>3</b> snipes");
    expect(equipment.pulse()).toContain("<b>0</b> flips");
    expect(equipment.pulse()).toContain("3 rows");
    state.book = { at: iso(), bids: [{ price: 0.1, quantity: 2000 }] };
    state.salesErrors = { knife: "the API answered 503" };
    const r = equipment.render(state);
    expect(r).toMatchObject({
      hits: 0,
      flips: 3,
      scanned: 3,
      readable: 3,
      codes: ["knife"],
    });
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
  it("renders the Market section: scrap floors, the selected item's sales, the legend", () => {
    equipment.render(state);
    equipment.renderMarket(body, state);
    expect(body.querySelectorAll(".lens-floor")).toHaveLength(6);
    expect(
      body.querySelector('.lens-floor[data-rarity="mythic"]').textContent,
    ).toContain("291.600");
    expect(body.textContent).toContain(
      "Reading the recent sales of common knife",
    );
    state.salesByCode = {
      knife: sales([1, 1.1, 0.9, 1.2, 1.05].map((p, i) => fill(p, i + 1))),
    };
    equipment.render(state);
    equipment.renderMarket(body, state);
    expect(body.textContent).toContain("5 sales in 7 d, any stats");
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
      "Reading the recent sales of mythic jet",
    );
  });
});
