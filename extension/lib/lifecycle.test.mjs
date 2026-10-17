// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { startLens } from "./app.mjs";
import { DEFAULTS } from "./settings.mjs";
import {
  mapLootItem,
  withFallbackPalette,
  paletteFromSamples,
  rarityFromBorder,
} from "./dom.mjs";
import { createScheduler } from "./scheduler.mjs";
import { setHtml } from "./ui.mjs";

const ME = "697b55e4bcecf3b37667e0d1";
let app;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
  window.history.replaceState({}, "", "/market");
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  document.body.innerHTML =
    '<main><div id="grid"><div id="item-code-selector-woodenCase"></div><div id="item-code-selector-oil"></div></div></main>';
});
afterEach(() => {
  app?.dispose();
  app = null;
  vi.useRealTimers();
  document.body.innerHTML = "";
});
const settle = async (ms = 300) => {
  await vi.advanceTimersByTimeAsync(ms);
};
function mockRuntime(overrides = {}) {
  const info = {
    settings: { ...DEFAULTS },
    hasKey: true,
    revision: 1,
    authRevision: 1,
    ...overrides,
  };
  return {
    info,
    sendMessage: vi.fn(async (msg) => {
      if (msg.type === "getSettings") return structuredClone(info);
      if (msg.type === "saveSettings") {
        Object.assign(info.settings, msg.settings);
        info.revision++;
        return structuredClone(info);
      }
      if (msg.type === "cases")
        return { cases: { at: new Date().toISOString(), books: {} } };
      if (msg.type === "avg")
        return { avg: { at: new Date().toISOString(), values: {}, times: {} } };
      return {};
    }),
  };
}

describe("SPA lifecycle and DOM work", () => {
  it("ignores its own renders and clock mutations; stationary UI does not rescan on every tick", async () => {
    const runtime = mockRuntime();
    app = await startLens(runtime);
    await settle();
    const first = app.metrics.scans;
    await settle(20000);
    expect(app.metrics.scans).toBe(first);
    expect(
      runtime.sendMessage.mock.calls.filter(([m]) => m.type === "cases"),
    ).toHaveLength(1);
    expect(document.querySelectorAll("#scrap-sniper-cases")).toHaveLength(1);
  });
  it("coalesces native mutation bursts and removes panels after SPA navigation", async () => {
    app = await startLens(mockRuntime());
    await settle();
    const before = app.metrics.scans;
    for (let i = 0; i < 100; i++)
      document
        .getElementById("grid")
        .appendChild(document.createElement("div"));
    await settle();
    expect(app.metrics.scans - before).toBe(1);
    window.history.pushState({}, "", "/profile");
    await settle(5100);
    expect(document.getElementById("scrap-sniper-cases")).toBeNull();
    app.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not fetch in a hidden tab, and refreshes after becoming visible", async () => {
    const runtime = mockRuntime();
    app = await startLens(runtime);
    await settle();
    const count = runtime.sendMessage.mock.calls.length;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    await settle(70000);
    expect(runtime.sendMessage).toHaveBeenCalledTimes(count);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(
      runtime.sendMessage.mock.calls.filter(([m]) => m.type === "cases"),
    ).toHaveLength(2);
  });
  it("reads the averages at once under the default drop policy, which sells from epic", async () => {
    const runtime = mockRuntime();
    app = await startLens(runtime);
    await settle();
    expect(
      runtime.sendMessage.mock.calls.filter(([m]) => m.type === "avg"),
    ).toHaveLength(1);
    expect(
      runtime.sendMessage.mock.calls.filter(([m]) => m.type === "cases"),
    ).toHaveLength(1);
  });
  it("keeps market books when details are opened and loads averages only on demand under a scrap-only policy", async () => {
    const runtime = mockRuntime({
      settings: { ...DEFAULTS, sellFrom: "never" },
    });
    app = await startLens(runtime);
    await settle();
    expect(runtime.sendMessage.mock.calls.some(([m]) => m.type === "avg")).toBe(
      false,
    );
    document.querySelector('[data-action="collapse"]').click();
    await settle();
    expect(
      runtime.sendMessage.mock.calls.filter(([m]) => m.type === "cases"),
    ).toHaveLength(1);
    expect(
      runtime.sendMessage.mock.calls.filter(([m]) => m.type === "avg"),
    ).toHaveLength(1);
  });
  it("clears old account data on auth revision changes and retains a rejected-key notice", async () => {
    const runtime = mockRuntime();
    app = await startLens(runtime);
    await settle();
    runtime.info.authRevision++;
    runtime.info.revision++;
    runtime.info.hasKey = false;
    await settle(5100);
    // no key is no notice: the books are read keyless
    expect(
      document.getElementById("scrap-sniper-cases").textContent,
    ).not.toContain("API key");
    runtime.info.authRevision++;
    runtime.info.revision++;
    runtime.info.hasKey = true;
    runtime.info.rejected = true;
    await settle(5100);
    expect(document.getElementById("scrap-sniper-cases").textContent).toContain(
      "API key rejected",
    );
  });
  it("keeps the nearest-case anchor after its own long content is inserted", () => {
    document.body.innerHTML =
      '<main><div id="menu"><span>Nearest wooden case</span><span>7 regions away</span></div></main>';
    const first = mapLootItem();
    expect(first.hops).toBe(7);
    const own = document.createElement("span");
    own.dataset.lens = "";
    own.textContent = "long travel output ".repeat(100);
    first.item.appendChild(own);
    for (let i = 0; i < 10; i++) {
      const next = mapLootItem();
      expect(next.item).toBe(first.item);
      expect(next.hops).toBe(7);
    }
  });
  it("preserves known hover colors alongside live calibration", () => {
    const palette = withFallbackPalette(
      paletteFromSamples([{ code: "jet", color: "rgb(57,15,16)" }]),
    );
    expect(rarityFromBorder("rgb(150,38,40)", palette)).toBe("mythic");
  });
  it("performs no DOM replacement for unchanged markup", () => {
    const el = document.createElement("div");
    setHtml(el, "<button>Example</button>");
    const button = el.firstChild;
    expect(setHtml(el, "<button>Example</button>")).toBe(false);
    expect(el.firstChild).toBe(button);
  });

  it("keeps a scrolling box's place and the focused control across a rewrite, a new box starting at the top", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const html = (key, n) =>
      `<div class="box" data-scroll="${key}"><p>${n}</p></div><button data-action="desk-page" data-page="first">«</button><button data-action="desk-page" data-page="next">›</button>`;
    setHtml(el, html("ledger:all:all:0", 1));
    el.querySelector(".box").scrollTop = 120;
    el.querySelector('[data-page="next"]').focus();
    setHtml(el, html("ledger:all:all:0", 2));
    expect(el.querySelector(".box").scrollTop).toBe(120);
    expect(document.activeElement.dataset.page).toBe("next");
    // another page is another box
    setHtml(el, html("ledger:all:all:1", 3));
    expect(el.querySelector(".box").scrollTop).toBe(0);
    el.remove();
  });

  const marketFixture = () => {
    document.body.innerHTML =
      '<main><div id="tax"><span>Market tax 5%</span></div><div><div id="item-code-selector-jet" style="z-index:1;border-color:rgb(57,15,16)"></div><div id="item-code-selector-boots5" style="border-color:rgb(43,43,18)"></div></div><div id="offers"></div></main>';
  };
  /** The worker's history and view for a player with one held legendary boots craft, so the view asks for the boots' sales. */
  const historyFor = (userId) => ({
    history: {
      userId,
      username: "Tester",
      done: true,
      count: 1,
      rev: 1,
      at: new Date().toISOString(),
    },
  });
  const ledgerFor = (userId) => ({
    ledger: {
      meta: {
        userId,
        username: "Tester",
        done: true,
        count: 1,
        rev: 1,
        oldestAt: new Date().toISOString(),
        at: new Date().toISOString(),
      },
      windows: Object.fromEntries(
        ["today", "week", "month", "all"].map((k) => [
          k,
          {
            crafted: {
              n: 1,
              cost: 149,
              held: 1,
              heldValue: 0,
              heldPriced: 0,
              proceeds: 0,
              sold: 0,
              scrapped: 0,
              realized: 0,
              estimated: 0,
              estimatedKnown: 0,
              costUnknown: 0,
            },
            opened: { n: 0 },
            bought: { n: 0 },
            looted: { n: 0 },
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
          },
        ]),
      ),
      rows: [],
      rowsTotal: 0,
      salesWanted: ["boots5"],
      at: new Date().toISOString(),
    },
  });
  const marketRuntime = (settings, salesImpl) => {
    const runtime = mockRuntime({ settings: { ...DEFAULTS, ...settings } });
    const base = runtime.sendMessage.getMockImplementation();
    runtime.sendMessage.mockImplementation(async (msg) => {
      if (msg.type === "book")
        return {
          book: {
            at: new Date().toISOString(),
            bid: 0.2,
            ask: 0.21,
            bids: [{ price: 0.2, quantity: 1e6 }],
            asks: [{ price: 0.21, quantity: 1e6 }],
          },
        };
      if (msg.type === "sales")
        return salesImpl
          ? salesImpl(msg)
          : {
              sales: {
                code: msg.itemCode,
                at: new Date().toISOString(),
                complete: true,
                fills: [],
              },
            };
      if (msg.type === "history") return historyFor(msg.userId);
      if (msg.type === "ledger") return ledgerFor(msg.userId);
      return base(msg);
    });
    return runtime;
  };
  const salesCalls = (runtime, code) =>
    runtime.sendMessage.mock.calls.filter(
      ([m]) => m.type === "sales" && m.itemCode === code,
    ).length;
  const bar = () => document.getElementById("scrap-sniper-bar");
  const bodyText = () => bar().querySelector(".lens-body").textContent;

  it("mounts the bar once on the equipment market with the open section, removes it on navigation, restores it on return, and cleans up", async () => {
    window.history.replaceState({}, "", "/market/equipments");
    marketFixture();
    const runtime = marketRuntime({ panel: "craft" });
    app = await startLens(runtime);
    await settle();
    const bars = () => document.querySelectorAll("#scrap-sniper-bar").length;
    expect(bars()).toBe(1);
    expect(bar().nextElementSibling.id).toBe("tax");
    expect(bar().querySelectorAll('[data-action="tab"]')).toHaveLength(3);
    expect(
      bar()
        .querySelector('[data-action="tab"][data-tab="craft"]')
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(bodyText()).toContain("Chosen");
    expect(
      runtime.sendMessage.mock.calls.filter(([m]) => m.type === "avg"),
    ).toHaveLength(1); // the rows and the board are valued at the game's averages
    expect(
      runtime.sendMessage.mock.calls.filter(([m]) => m.type === "history"),
    ).toHaveLength(0); // no own-profile link on the page and no id set: nothing to read
    for (let i = 0; i < 50; i++)
      document
        .getElementById("offers")
        .appendChild(document.createElement("div"));
    await settle();
    await settle(5100);
    expect(bars()).toBe(1);
    // the same tab closes the section; another opens it
    bar().querySelector('[data-action="tab"][data-tab="craft"]').click();
    await settle();
    expect(bar().querySelector(".lens-body").hidden).toBe(true);
    bar().querySelector('[data-action="tab"][data-tab="market"]').click();
    await settle();
    expect(bar().querySelector(".lens-body").hidden).toBe(false);
    expect(bodyText()).toContain("mythic jet"); // the grid's selected item, its fills just read
    window.history.pushState({}, "", "/profile");
    await settle(5100);
    expect(bars()).toBe(0);
    expect(document.querySelector("[data-lens]")).toBeNull();
    window.history.pushState({}, "", "/market/equipments");
    await settle(5100);
    expect(bars()).toBe(1);
    app.dispose();
    expect(bars()).toBe(0);
    expect(document.querySelector("[data-lens]")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("mounts the bar on the grid's section with only the craft tabs when the Equipment module is off and the page shows no tax notice", async () => {
    window.history.replaceState({}, "", "/market/equipments");
    document.body.innerHTML =
      '<main><section id="market"><div><div id="item-code-selector-jet" style="border-color:rgb(57,15,16)"></div></div><div id="offers"></div></section></main>';
    app = await startLens(marketRuntime({ equipment: false, panel: "craft" }));
    await settle();
    expect(document.querySelectorAll("#scrap-sniper-bar")).toHaveLength(1);
    expect(bar().nextElementSibling?.id).toBe("market");
    expect(bar().querySelectorAll('[data-action="tab"]')).toHaveLength(2);
    expect(
      bar().querySelector('[data-action="tab"][data-tab="market"]'),
    ).toBeNull();
    expect(bodyText()).toContain("Chosen");
    for (let i = 0; i < 20; i++)
      document
        .getElementById("offers")
        .appendChild(document.createElement("div"));
    await settle(5100);
    expect(document.querySelectorAll("#scrap-sniper-bar")).toHaveLength(1);
    // a notice appearing later becomes the anchor, with no second bar
    const notice = document.createElement("div");
    notice.innerHTML = "<span>Market tax 5%</span>";
    document.getElementById("market").prepend(notice);
    await settle(5100);
    expect(document.querySelectorAll("#scrap-sniper-bar")).toHaveLength(1);
    expect(bar().nextElementSibling).toBe(notice);
    window.history.pushState({}, "", "/profile");
    await settle(5100);
    expect(document.querySelectorAll("#scrap-sniper-bar")).toHaveLength(0);
    window.history.pushState({}, "", "/market/equipments");
    await settle(5100);
    expect(document.querySelectorAll("#scrap-sniper-bar")).toHaveLength(1);
  });
  it("mounts the bar on the v0.27 auction page, under its tax notice", async () => {
    window.history.replaceState({}, "", "/market/auctions");
    document.body.innerHTML =
      '<main><div id="tax"><div>Live auctions</div><span>Bids are shown before tax: when you bid, your country adds its 10% market tax. A bid at the max price wins at once.</span></div><div id="offers"></div></main>';
    app = await startLens(marketRuntime({ panel: "craft" }));
    await settle();
    expect(document.querySelectorAll("#scrap-sniper-bar")).toHaveLength(1);
    expect(bar().nextElementSibling.id).toBe("tax");
    expect(bar().querySelectorAll('[data-action="tab"]')).toHaveLength(3);
    expect(bodyText()).toContain("Chosen");
  });
  it("puts a start and max price in the v0.27 Start an auction form once a piece is picked", async () => {
    window.history.replaceState({}, "", "/market/auctions");
    document.body.innerHTML =
      '<main><div id="tax"><span>Bids are shown before tax: your country adds its 10% market tax.</span></div></main><div role="dialog"><div>Start an auction</div><div class="tile" style="background-image: linear-gradient(45deg, red, black)"><img alt="sniper"><div>123</div><div>16<b>%</b></div><div>100<b>%</b></div></div><label><span>Start price</span><input name="startPrice" value="0"></label><label><span>Max price (instant buy)</span><input name="maxPrice" value="131.846"></label><span>A bid at it buys the item at once. From <span>82.404</span> to <span>131.846</span>, 100% to 160% of the estimated value.</span><button>Close</button><button type="submit">Start auction</button></div>';
    const runtime = marketRuntime({ panel: "none" });
    app = await startLens(runtime);
    await settle(3000);
    const hint = document.querySelector('[role="dialog"] .ss-auction');
    expect(hint).not.toBeNull();
    expect(hint.previousElementSibling.querySelector("input").name).toBe(
      "maxPrice",
    );
    expect(salesCalls(runtime, "sniper")).toBeGreaterThanOrEqual(1);
  });
  it("reads the grid's item and the ledger's held item once each instead of looping between them", async () => {
    window.history.replaceState({}, "", "/market/equipments?item=jet");
    marketFixture();
    const runtime = marketRuntime({ panel: "ledger", userId: ME });
    app = await startLens(runtime);
    await settle(3000);
    expect(
      runtime.sendMessage.mock.calls.filter(([m]) => m.type === "history")
        .length,
    ).toBeGreaterThanOrEqual(1);
    expect(bodyText()).toContain("Tester");
    expect(salesCalls(runtime, "jet")).toBe(1);
    expect(salesCalls(runtime, "boots5")).toBe(1);
    expect(app.metrics.scans).toBeLessThan(10);
  });
  it("asks for the ledger again as soon as the sales it wanted are read, not on the next half-minute", async () => {
    window.history.replaceState({}, "", "/market/equipments");
    marketFixture();
    const runtime = marketRuntime({ panel: "ledger", userId: ME });
    app = await startLens(runtime);
    await settle(3000);
    const ledgerCalls = () =>
      runtime.sendMessage.mock.calls.filter(([m]) => m.type === "ledger")
        .length;
    expect(salesCalls(runtime, "boots5")).toBe(1);
    // the first view, then the view again once the boots' sales are in; no loop after that
    expect(ledgerCalls()).toBe(2);
    await settle(10_000);
    expect(ledgerCalls()).toBe(2);
    expect(salesCalls(runtime, "boots5")).toBe(1);
  });
  it("marks the inventory's Quick dismantle window off the market, with the history read there too", async () => {
    window.history.replaceState({}, "", `/user/${ME}/inventory`);
    document.body.innerHTML = "<main></main>";
    const runtime = marketRuntime({ userId: ME });
    const base = runtime.sendMessage.getMockImplementation();
    runtime.sendMessage.mockImplementation(async (msg) => {
      const r = await base(msg);
      if (msg.type === "ledger")
        r.ledger.heldPieces = [
          {
            code: "boots5",
            skills: { dodge: 32 },
            source: "crafted",
            cost: 150,
          },
        ];
      return r;
    });
    app = await startLens(runtime);
    const win = document.createElement("div");
    win.setAttribute("role", "dialog");
    win.innerHTML = `<div class="card"><div class="title">Quick dismantle</div><div class="cell"><div class="tile" style="background-image: linear-gradient(45deg, red, black)"><div><img alt="dieselBoots" src="x.png"></div><div>32<b>%</b></div><div>88<b>%</b></div></div></div></div>`;
    document.body.appendChild(win);
    document.body.click();
    await settle(3000);
    const bar = document.querySelector(".ss-pick-bar");
    expect(bar).not.toBeNull();
    expect(bar.previousElementSibling.textContent).toBe("Quick dismantle");
    // the view was asked for here, off the market, so the tiles can be marked
    expect(
      runtime.sendMessage.mock.calls.some(([m]) => m.type === "ledger"),
    ).toBe(true);
    expect(document.querySelector(".ss-src-badge")).not.toBeNull();
    // a filter picked here stays picked through the scans that follow the click
    document.querySelector('[data-picker-source="crafted"]').click();
    await settle(6000);
    expect(
      document
        .querySelector('[data-picker-source="crafted"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(document.querySelectorAll(".ss-pick-bar")).toHaveLength(1);
  });
  it("suggests a price in the sell form from the sales of the picked piece's stats, and Use fills the game's input", async () => {
    window.history.replaceState({}, "", "/market/equipments");
    marketFixture();
    const at = (h) => new Date(Date.now() - h * 3600e3).toISOString();
    const runtime = marketRuntime({ userId: ME }, (msg) => ({
      sales: {
        code: msg.itemCode,
        at: new Date().toISOString(),
        complete: true,
        fills: [185, 184, 186].map((price, i) => ({
          price,
          at: at(i + 1),
          state: 100,
          code: msg.itemCode,
          skills: { dodge: 32 },
        })),
      },
    }));
    app = await startLens(runtime);
    await settle(500);
    const form = document.createElement("div");
    form.setAttribute("role", "dialog");
    form.innerHTML = `<div class="card"><div>Sell an item</div><div class="tile" style="background-image: linear-gradient(45deg, red, black)"><img alt="dieselBoots" src="x.png"><div>32<b>%</b></div><div>100<b>%</b></div></div><div>Market average <span>181.3</span></div><div><label><span>PRICE</span><input name="price" value="190"></label><div>Suggested price <span>190</span></div><div><span>133</span><span>304</span></div></div><div>You receive <span>190</span></div><button>Put on sale</button></div>`;
    document.body.appendChild(form);
    document.body.click();
    await settle(3000);
    expect(
      runtime.sendMessage.mock.calls.some(
        ([m]) => m.type === "sales" && m.itemCode === "boots5",
      ),
    ).toBe(true);
    const hint = document.querySelector(".ss-sell");
    expect(hint).not.toBeNull();
    expect(hint.textContent).toContain("185");
    hint.querySelector("[data-sell-use]").click();
    expect(form.querySelector('input[name="price"]').value).toBe("185");
  });
  it("works without an API key: no notice, no sales or history asked for, and each place says what needs the key", async () => {
    window.history.replaceState({}, "", "/market/equipments");
    marketFixture();
    const runtime = marketRuntime({ panel: "market", userId: ME });
    runtime.info.hasKey = false;
    app = await startLens(runtime);
    await settle(3000);
    const types = () => runtime.sendMessage.mock.calls.map(([m]) => m.type);
    expect(types()).toContain("book");
    expect(document.body.textContent).not.toContain("Add your WarEra API key");
    // the market's sales line, then the ledger, say they need the key
    expect(bodyText()).toContain("need your API key");
    bar().querySelector('[data-action="tab"][data-tab="ledger"]').click();
    await settle(1000);
    expect(bodyText()).toContain("needs your API key");
    // the sell form prices from the asks and the game's estimate, with Use
    const form = document.createElement("div");
    form.setAttribute("role", "dialog");
    form.innerHTML = `<div class="card"><div>Sell an item</div><div class="tile" style="background-image: linear-gradient(45deg, red, black)"><img alt="dieselBoots" src="x.png"><div>32<b>%</b></div><div>100<b>%</b></div></div><div>Market average <span>181.3</span></div><div><label><span>PRICE</span><input name="price" value="190"></label><div>Suggested price <span>190</span></div><div><span>133</span><span>304</span></div></div><div>You receive <span>190</span></div><button>Put on sale</button></div>`;
    document.body.appendChild(form);
    document.body.click();
    await settle(3000);
    const hint = document.querySelector(".ss-sell");
    expect(hint?.textContent).toContain("190");
    expect(hint.querySelector("[data-sell-use]")).not.toBeNull();
    expect(hint.textContent).toContain("sales need your API key");
    form.remove();
    // the picker's sources rest on the history, which needs the key
    const win = document.createElement("div");
    win.setAttribute("role", "dialog");
    win.innerHTML = `<div class="card"><div class="title">Quick dismantle</div><div class="cell"><div class="tile" style="background-image: linear-gradient(45deg, red, black)"><div><img alt="dieselBoots" src="x.png"></div><div>32<b>%</b></div><div>88<b>%</b></div></div></div></div>`;
    document.body.appendChild(win);
    document.body.click();
    await settle(3000);
    expect(document.querySelector(".ss-pick-bar")?.textContent).toContain(
      "API key",
    );
    expect(types()).not.toContain("sales");
    expect(types()).not.toContain("history");
  });
  it("marks the inventory picker a moment after the click that opened it, not on the next tick", async () => {
    window.history.replaceState({}, "", "/market/equipments");
    marketFixture();
    const runtime = marketRuntime({ userId: ME });
    app = await startLens(runtime);
    await settle(1000);
    // the game opens the picker as a portal on body: our roots do not see it arrive
    const picker = document.createElement("div");
    picker.setAttribute("role", "dialog");
    picker.innerHTML = `<div><div>Items</div><div>0/5</div><div class="cell"><div class="tile" style="background-image: linear-gradient(45deg, red, black)"><div><img alt="winterJet" src="x.png"></div><div>270</div><div>50<b>%</b></div><div>100<b>%</b></div></div></div></div>`;
    document.body.appendChild(picker);
    document.body.click();
    await settle(500);
    expect(document.querySelector(".ss-pick-bar")).not.toBeNull();
  });
  it("saves the Eco / War switch from the page and asks for the view again in the new mode", async () => {
    window.history.replaceState({}, "", "/market/equipments");
    marketFixture();
    const runtime = marketRuntime({ panel: "ledger", userId: ME });
    app = await startLens(runtime);
    await settle(3000);
    const before = runtime.sendMessage.mock.calls.length;
    bar().querySelector('[data-action="ledger-mode"][data-mode="war"]').click();
    await settle();
    const after = runtime.sendMessage.mock.calls.slice(before).map(([m]) => m);
    const saved = after.findIndex(
      (m) => m.type === "saveSettings" && m.settings?.ledgerMode === "war",
    );
    expect(saved).toBeGreaterThanOrEqual(0);
    expect(after.slice(saved + 1).some((m) => m.type === "ledger")).toBe(true);
    expect(runtime.info.settings.ledgerMode).toBe("war");
  });
  it("finds the market the game draws after the app starts at once, not on the next tick, and stops looking after a while", async () => {
    window.history.replaceState({}, "", "/market/equipments");
    document.body.innerHTML = "<main></main>";
    const runtime = marketRuntime({});
    app = await startLens(runtime);
    await settle(300);
    expect(bar()).toBeNull();
    // the game draws the market after its own read
    marketFixture();
    await settle(40); // a frame or two: far less than the five-second tick
    expect(bar()).not.toBeNull();
    // fifteen seconds on, a change outside what the bar watches no longer calls for a scan by itself
    await settle(16_000);
    const scans = app.metrics.scans;
    document.body.appendChild(document.createElement("p"));
    await settle(40);
    expect(app.metrics.scans).toBe(scans);
    // a click looks again for a few seconds
    document.body.click();
    await settle(400);
    const after = app.metrics.scans;
    document.body.appendChild(document.createElement("p"));
    await settle(40);
    expect(app.metrics.scans).toBeGreaterThan(after);
  });
  it("hands a press of the game's CRAFT button to the worker with the window's pick, and asks the worker for the Ledger's other pages", async () => {
    window.history.replaceState({}, "", "/market/equipments");
    marketFixture();
    const runtime = marketRuntime({ userId: ME, panel: "ledger" });
    const base = runtime.sendMessage.getMockImplementation();
    runtime.sendMessage.mockImplementation(async (msg) => {
      const r = await base(msg);
      if (msg.type === "ledger")
        Object.assign(r.ledger, {
          rows: [
            {
              id: "a",
              code: "sniper",
              rarity: "epic",
              source: "crafted",
              at: new Date().toISOString(),
              cost: 56,
              fate: "held",
              chosen: true,
              chosenBy: "seen",
              value: null,
            },
          ],
          rowsTotal: 130,
          page: msg.page ?? 0,
          pages: 3,
          pageSize: 50,
          source: msg.source ?? "all",
          sources: { all: 130, crafted: 130 },
        });
      if (msg.type === "craftPick") return { ok: true };
      return r;
    });
    app = await startLens(runtime);
    await settle(300);
    const asked = () =>
      runtime.sendMessage.mock.calls
        .filter(([m]) => m.type === "ledger")
        .map(([m]) => m)
        .at(-1);
    expect(asked()).toMatchObject({ page: 0, source: "all" });
    bar().querySelector('[data-action="desk-page"][data-page="next"]').click();
    await settle(300);
    expect(asked()).toMatchObject({ page: 1, source: "all", window: "today" });
    expect(bodyText()).toContain("51–100");
    bar()
      .querySelector('[data-action="desk-source"][data-source="crafted"]')
      .click();
    await settle(300);
    expect(asked()).toMatchObject({ page: 0, source: "crafted" });
    // the game's craft window on the epic tier, a slot picked: the button reads CRAFT
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.innerHTML = `<div>CRAFT ITEMS\nMythic\n1.46K\n32\nLegendary\n486\n16\nEpic\n162\n8\nRare\n54\n4\nUncommon\n18\n2\nCommon\n6\n1\nEpic\n?</div><div><button>CLOSE</button><button>CRAFT</button></div>`;
    document.body.appendChild(dialog);
    await settle(400);
    const game = vi.fn();
    const craft = [...dialog.querySelectorAll("button")].at(-1);
    craft.addEventListener("click", game);
    craft.click();
    await settle(100);
    expect(game).toHaveBeenCalledTimes(1); // the game's own click goes on
    const picks = runtime.sendMessage.mock.calls.filter(
      ([m]) => m.type === "craftPick",
    );
    expect(picks).toHaveLength(1);
    expect(picks[0][0]).toMatchObject({
      userId: ME,
      tier: "epic",
      chosen: true,
      slot: null,
    });
    expect(Math.abs(picks[0][0].at - Date.now())).toBeLessThan(1000);
    // the history is read again soon after, to find the craft
    const before = runtime.sendMessage.mock.calls.filter(
      ([m]) => m.type === "history" && m.force,
    ).length;
    await settle(3000);
    expect(
      runtime.sendMessage.mock.calls.filter(
        ([m]) => m.type === "history" && m.force,
      ).length,
    ).toBeGreaterThan(before);
  });
  it("reads the craft window's tier first, today's crafts of it before the other slots, ahead of the market's queue", async () => {
    window.history.replaceState({}, "", "/market/equipments?item=jet");
    marketFixture();
    let release = null;
    const runtime = marketRuntime({ userId: ME }, async (msg) => {
      // the grid's jet is read first and slowly, so everything else queues behind it
      if (msg.itemCode === "jet" && !release)
        await new Promise((r) => (release = r));
      return {
        sales: {
          code: msg.itemCode,
          at: new Date().toISOString(),
          complete: true,
          fills: [],
        },
      };
    });
    const base = runtime.sendMessage.getMockImplementation();
    runtime.sendMessage.mockImplementation(async (msg) => {
      const r = await base(msg);
      if (msg.type === "ledger")
        r.ledger.craftsToday = [
          { code: "gloves5", rarity: "legendary", fate: "held", worn: false },
        ];
      return r;
    });
    app = await startLens(runtime);
    await settle(300);
    // the game's craft window opens on the legendary tier
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.innerHTML = `<div>CRAFT ITEMS\nMythic\n1.46K\n32\nLegendary\n486\n16\nEpic\n162\n8\nRare\n54\n4\nUncommon\n18\n2\nCommon\n6\n1\nLegendary\n?</div><div><button>CLOSE</button><button>CRAFT RANDOM</button></div>`;
    document.body.appendChild(dialog);
    await settle(6000); // the next tick's scan finds the window while the jet is still being read
    release?.();
    await settle(3000);
    const order = runtime.sendMessage.mock.calls
      .filter(([m]) => m.type === "sales")
      .map(([m]) => m.itemCode);
    const legendary = [
      "tank",
      "helmet5",
      "chest5",
      "gloves5",
      "pants5",
      "boots5",
    ];
    for (const code of legendary) expect(order).toContain(code);
    // after the grid's jet: today's craft first, then the tier's other slots
    expect(order[0]).toBe("jet");
    expect(order[1]).toBe("gloves5");
    expect(order.slice(1, 7).sort()).toEqual([...legendary].sort());
  });
  it("runs one forced read for the grid's new item when its refresh was queued behind another read, not a plain read and then the forced one", async () => {
    window.history.replaceState({}, "", "/market/equipments?item=jet");
    marketFixture();
    let releaseJet = null;
    const runtime = marketRuntime({}, (msg) => {
      const sales = {
        sales: {
          code: msg.itemCode,
          at: new Date().toISOString(),
          complete: true,
          fills: [],
        },
      };
      if (msg.itemCode === "jet")
        return new Promise((resolve) => {
          releaseJet = () => resolve(sales);
        });
      return sales;
    });
    app = await startLens(runtime);
    await settle();
    expect(salesCalls(runtime, "jet")).toBe(1);
    expect(releaseJet).not.toBeNull();
    // the selection moves to the boots while jet's read is in flight, and Refresh is clicked
    document.getElementById("item-code-selector-jet").style.zIndex = "";
    document.getElementById("item-code-selector-boots5").style.zIndex = "1";
    document
      .getElementById("offers")
      .appendChild(document.createElement("div"));
    await settle(5100);
    bar().querySelector('[data-action="refresh"]').click();
    await settle();
    expect(salesCalls(runtime, "boots5")).toBe(0); // waits for jet
    releaseJet();
    await settle(3000);
    const boots = runtime.sendMessage.mock.calls.filter(
      ([m]) => m.type === "sales" && m.itemCode === "boots5",
    );
    expect(boots).toHaveLength(1);
    expect(boots[0][0].force).toBe(true);
    expect(salesCalls(runtime, "jet")).toBe(1);
  });
  it("retries a failed forced refresh of a cached item after the retry window, and the warning clears", async () => {
    window.history.replaceState({}, "", "/market/equipments?item=jet");
    marketFixture();
    const runtime = marketRuntime({ panel: "market" }, (msg) =>
      msg.force
        ? { error: "http", message: "the API answered 503" }
        : {
            sales: {
              code: msg.itemCode,
              at: new Date().toISOString(),
              complete: true,
              fills: [],
            },
          },
    );
    app = await startLens(runtime);
    await settle(3000);
    expect(salesCalls(runtime, "jet")).toBe(1);
    bar().querySelector('[data-action="refresh"]').click();
    await settle(500);
    expect(salesCalls(runtime, "jet")).toBe(2);
    expect(bodyText()).toContain("last read failed");
    // the cached read is still fresh, but the error ends its exemption: the next discovery scan past the window asks again, once
    await settle(40_000);
    expect(salesCalls(runtime, "jet")).toBe(3);
    expect(bodyText()).not.toContain("last read failed");
  });
  it("retries a failing sales read after a pause, not on every scan", async () => {
    window.history.replaceState({}, "", "/market/equipments?item=jet");
    marketFixture();
    const runtime = marketRuntime({ panel: "market" }, () => ({
      error: "http",
      message: "the API answered 503",
    }));
    app = await startLens(runtime);
    await settle(3000);
    expect(salesCalls(runtime, "jet")).toBe(1);
    expect(bodyText()).toContain("the API answered 503");
    await settle(16_000);
    expect(salesCalls(runtime, "jet")).toBe(1); // inside the retry window, and nothing scanned
    await settle(15_000); // the 30 s discovery scan asks again, once
    expect(salesCalls(runtime, "jet")).toBe(2);
    expect(app.metrics.scans).toBeLessThan(12);
  });
  it("keeps a failed read of the grid's item apart from the ledger's item, which reads fine", async () => {
    window.history.replaceState({}, "", "/market/equipments?item=jet");
    marketFixture();
    const runtime = marketRuntime({ panel: "ledger", userId: ME }, (msg) =>
      msg.itemCode === "jet"
        ? { error: "http", message: "the API answered 503" }
        : {
            sales: {
              code: msg.itemCode,
              at: new Date().toISOString(),
              complete: true,
              fills: [],
            },
          },
    );
    app = await startLens(runtime);
    await settle(3000);
    expect(salesCalls(runtime, "boots5")).toBe(1);
    expect(bodyText()).not.toContain("sales read failed"); // jet's failure is not its
  });
  it("keeps the bar in place and a focused tier button focused across native mutations", async () => {
    window.history.replaceState({}, "", "/market/equipments");
    marketFixture();
    app = await startLens(marketRuntime({ panel: "craft" }));
    await settle();
    const node = bar();
    const button = node.querySelector(
      '[data-action="desk-tier"][data-tier="4"]',
    );
    button.focus();
    expect(document.activeElement).toBe(button);
    for (let i = 0; i < 5; i++) {
      document
        .getElementById("offers")
        .appendChild(document.createElement("div"));
      await settle(1100);
    }
    expect(bar()).toBe(node);
    expect(bar().nextElementSibling.id).toBe("tax");
    expect(document.activeElement.dataset.tier).toBe("4");
  });
  it("survives repeated navigation away and back without duplicate panels or leaked nodes", async () => {
    window.history.replaceState({}, "", "/market/equipments");
    marketFixture();
    app = await startLens(marketRuntime({ panel: "craft" }));
    await settle();
    const count = () => document.querySelectorAll("[data-lens]").length;
    const first = count();
    expect(first).toBeGreaterThan(0);
    for (let cycle = 0; cycle < 3; cycle++) {
      window.history.pushState({}, "", "/profile");
      await settle(5100);
      expect(count()).toBe(0);
      window.history.pushState({}, "", "/market/equipments");
      await settle(5100);
      expect(document.querySelectorAll("#scrap-sniper-bar")).toHaveLength(1);
      expect(count()).toBe(first);
    }
    app.dispose();
    expect(count()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("runs before the next paint after a quiet spell, at most once a delay while the page keeps changing", async () => {
    const run = vi.fn();
    const s = createScheduler(run);
    s.schedule();
    await settle(33); // the next frame, two at most
    expect(run).toHaveBeenCalledTimes(1);
    // busy: the next run waits out the delay since the last one
    s.schedule();
    await settle(50);
    expect(run).toHaveBeenCalledTimes(1);
    await settle(60);
    expect(run).toHaveBeenCalledTimes(2);
    // quiet again: the next frame
    await settle(500);
    s.schedule();
    await settle(33);
    expect(run).toHaveBeenCalledTimes(3);
    // without frames (a test page, an old browser) the timer does it
    const plain = vi.fn();
    const t = createScheduler(plain, { frame: null });
    t.schedule();
    await settle(1);
    expect(plain).toHaveBeenCalledTimes(1);
  });
  it("does not starve under continuous mutations, and cancels on dispose", async () => {
    const run = vi.fn();
    const s = createScheduler(run);
    for (let i = 0; i < 20; i++) {
      s.schedule();
      await settle(10);
    }
    expect(run).toHaveBeenCalledTimes(2);
    s.schedule();
    s.cancel();
    await settle(100);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
