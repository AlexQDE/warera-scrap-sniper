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
    save: (p) => Object.assign(settings, p),
    refresh: vi.fn(),
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
  expect(row.textContent).toContain("+0.200 g");
  expect(row.textContent).not.toContain("291.600");
  expect(document.getElementById("buy").disabled).toBe(false);
  const annotation = row.querySelector(".ss-verdict");
  const content = annotation.firstChild;
  equipment.render(state);
  expect(row.querySelector(".ss-verdict")).toBe(annotation);
  expect(annotation.firstChild).toBe(content);
  expect(document.querySelectorAll("#scrap-sniper-bar")).toHaveLength(1);
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
it("removes annotations on setup errors and fully restores DOM on cleanup", () => {
  equipment.render(state);
  state.setup = "Add your API key";
  equipment.render(state);
  expect(row.querySelector(".ss-verdict")).toBeNull();
  expect(row.dataset.scrapSniper).toBeUndefined();
  expect(document.getElementById("scrap-sniper-bar").textContent).toContain(
    "Add your API key",
  );
  equipment.clear();
  expect(document.querySelector("[data-lens]")).toBeNull();
  expect(document.getElementById("buy")).not.toBeNull();
});
