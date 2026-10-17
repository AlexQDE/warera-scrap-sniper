// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { createEquipment } from "./equipment.mjs";
import { DEFAULTS } from "./settings.mjs";

let equipment, settings, price, row, state;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
  window.history.replaceState({}, "", "/market/equipments?item=jet");
  document.body.innerHTML =
    '<main><div id="tax"><span>Market tax</span></div><div><div id="item-code-selector-jet" style="z-index:1;border-color:rgb(57,15,16)"></div></div><div id="offers"><article id="offer"><div style="background:rgb(12,12,12);border:1px solid rgb(80,112,124)"><img alt="knife"></div><div class="price">1</div><button id="buy">BUY</button></article></div></main>';
  row = document.getElementById("offer");
  price = 1;
  // jsdom does not implement layout-derived innerText; provide the game's visible lines.
  Object.defineProperty(row, "innerText", {
    configurable: true,
    get: () =>
      `Item\n${price}\nBUY\n${row.querySelector(".ss-verdict")?.textContent ?? ""}`,
  });
  Object.defineProperty(document.getElementById("buy"), "innerText", {
    value: "BUY",
  });
  settings = { ...DEFAULTS };
  equipment = createEquipment({
    settings: () => settings,
    requestSales: vi.fn(),
  });
  state = {
    book: {
      at: new Date().toISOString(),
      bids: [{ price: 0.2, quantity: 2000 }],
    },
    error: null,
    setup: null,
    action: vi.fn(),
  };
});
afterEach(() => {
  equipment.clear();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

it("values the row rarity, not a newly selected unrelated grid item", () => {
  equipment.render(state);
  expect(row.dataset.scrapSniper).toBe("hit");
  expect(row.textContent).toContain("+0.20");
  expect(row.textContent).not.toContain("291.600");
  expect(document.getElementById("buy").disabled).toBe(false);
  const annotation = row.querySelector(".ss-verdict");
  const content = annotation.firstChild;
  equipment.render(state);
  expect(row.querySelector(".ss-verdict")).toBe(annotation);
  expect(annotation.firstChild).toBe(content);
});
it("distinguishes near losses, missing depth and stale quotes", () => {
  price = 1.3;
  settings.minMarginPct = -10;
  equipment.render(state);
  expect(row.dataset.scrapSniper).toBe("near");
  expect(row.textContent).toContain("NEAR MISS");
  state.book.bids = [];
  equipment.render(state);
  expect(row.dataset.scrapSniper).toBe("unknown");
  state.book.bids = [{ price: 0.2, quantity: 2000 }];
  state.book.at = "2026-09-16T11:00:00Z";
  equipment.render(state);
  expect(row.dataset.scrapSniper).toBe("stale");
  expect(row.textContent).not.toContain("SNIPE");
});
it("takes the rarity from the item code before the frame colour", () => {
  // a rare rifle in a frame painted like a mythic one: the code decides
  row.querySelector("img").setAttribute("alt", "rifle");
  row.querySelector("div").style.borderColor = "rgb(88, 27, 29)";
  equipment.render(state);
  // 54 scraps at 0.2: a rare's floor; a mythic's would be 291.6 (printed 292)
  expect(row.textContent).toContain("scrap 10.8");
  expect(row.textContent).not.toContain("scrap 292");
});
it("keeps the palette read off the grid after the grid closes (v0.27 shows it in a modal)", () => {
  // a skin names no rarity: the frame does, in a colour only the grid's calibration knows
  row.querySelector("img").setAttribute("alt", "winterJet");
  row.querySelector("div").style.borderColor = "rgb(200, 100, 50)";
  document.getElementById("item-code-selector-jet").style.borderColor =
    "rgb(200, 100, 50)";
  price = 200;
  equipment.render(state);
  expect(row.dataset.scrapSniper).toBe("hit"); // read as mythic: 1458 scraps at 0.2
  expect(row.textContent).toContain("scrap 292");
  document.getElementById("item-code-selector-jet").remove();
  vi.advanceTimersByTime(31_000);
  state.book.at = new Date().toISOString();
  equipment.render(state);
  expect(row.dataset.scrapSniper).toBe("hit");
  expect(row.textContent).toContain("scrap 292");
});
it("says so when the page shows offer buttons it cannot read", () => {
  window.history.replaceState({}, "", "/market/auctions");
  document.body.innerHTML =
    '<main><div id="tax"><span>10% market tax</span></div><article id="card"><div style="background:rgb(12,12,12)"><img alt="rifle"></div><button id="bid">BID 5</button></article></main>';
  const r = equipment.render(state);
  expect(r.count).toBe(0);
  expect(r.unread).toBe(1);
  expect(equipment.pulse()).toContain("offers not read");
  document.body.innerHTML = "<main></main>";
  expect(equipment.render(state).unread).toBe(0);
  expect(equipment.pulse()).toBe("");
});
it("removes annotations on setup errors and fully restores DOM on cleanup", () => {
  equipment.render(state);
  state.setup = "Add your API key";
  equipment.render(state);
  expect(row.querySelector(".ss-verdict")).toBeNull();
  expect(row.dataset.scrapSniper).toBeUndefined();
  equipment.clear();
  expect(document.querySelector("[data-lens]")).toBeNull();
  expect(document.getElementById("buy")).not.toBeNull();
});
