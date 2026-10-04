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
    expect(document.getElementById("scrap-sniper-cases").textContent).toContain(
      "Add your WarEra API key",
    );
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
  it("mounts the equipment panel and the Craft Desk once on the equipment market, removes them on navigation, restores them on return, and cleans up", async () => {
    window.history.replaceState({}, "", "/market/equipments");
    document.body.innerHTML =
      '<main><div id="tax"><span>Market tax 5%</span></div><div><div id="item-code-selector-jet" style="border-color:rgb(57,15,16)"></div></div><div id="offers"></div></main>';
    const runtime = mockRuntime({
      settings: { ...DEFAULTS, craftCollapsed: false },
    });
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
      if (msg.type === "ledgerGet")
        return { ledger: { version: 1, entries: [] } };
      return base(msg);
    });
    app = await startLens(runtime);
    await settle();
    const panels = () => [
      document.querySelectorAll("#scrap-sniper-bar").length,
      document.querySelectorAll("#warera-plus-craft").length,
    ];
    expect(panels()).toEqual([1, 1]);
    expect(
      document.getElementById("scrap-sniper-bar").nextElementSibling.id,
    ).toBe("warera-plus-craft");
    expect(document.getElementById("warera-plus-craft").textContent).toContain(
      "Craft Desk",
    );
    expect(
      runtime.sendMessage.mock.calls.filter(([m]) => m.type === "ledgerGet"),
    ).toHaveLength(1);
    for (let i = 0; i < 50; i++)
      document
        .getElementById("offers")
        .appendChild(document.createElement("div"));
    await settle();
    await settle(5100);
    expect(panels()).toEqual([1, 1]);
    expect(
      runtime.sendMessage.mock.calls.filter(([m]) => m.type === "ledgerGet")
        .length,
    ).toBeLessThanOrEqual(2); // the initial load plus one per-tick re-read for other tabs' writes
    window.history.pushState({}, "", "/profile");
    await settle(5100);
    expect(panels()).toEqual([0, 0]);
    expect(document.querySelector("[data-lens]")).toBeNull();
    window.history.pushState({}, "", "/market/equipments");
    await settle(5100);
    expect(panels()).toEqual([1, 1]);
    app.dispose();
    expect(panels()).toEqual([0, 0]);
    expect(document.querySelector("[data-lens]")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  const marketFixture = () => {
    document.body.innerHTML =
      '<main><div id="tax"><span>Market tax 5%</span></div><div><div id="item-code-selector-jet" style="z-index:1;border-color:rgb(57,15,16)"></div><div id="item-code-selector-boots5" style="border-color:rgb(43,43,18)"></div></div><div id="offers"></div></main>';
  };
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
      if (msg.type === "ledgerGet")
        return { ledger: { version: 1, entries: [] } };
      return base(msg);
    });
    return runtime;
  };
  const salesCalls = (runtime, code) =>
    runtime.sendMessage.mock.calls.filter(
      ([m]) => m.type === "sales" && m.itemCode === code,
    ).length;
  it("mounts the Craft Desk on the grid's section when the Equipment module is off and the page shows no tax notice", async () => {
    window.history.replaceState({}, "", "/market/equipments");
    document.body.innerHTML =
      '<main><section id="market"><div><div id="item-code-selector-jet" style="border-color:rgb(57,15,16)"></div></div><div id="offers"></div></section></main>';
    app = await startLens(
      marketRuntime({ equipment: false, craftCollapsed: false }),
    );
    await settle();
    expect(document.querySelectorAll("#scrap-sniper-bar")).toHaveLength(0);
    const desk = () => document.querySelectorAll("#warera-plus-craft");
    expect(desk()).toHaveLength(1);
    expect(desk()[0].nextElementSibling?.id).toBe("market");
    expect(desk()[0].textContent).toContain("Craft Desk");
    expect(desk()[0].textContent).toContain("none read"); // no notice on the page: the tax field says so
    for (let i = 0; i < 20; i++)
      document
        .getElementById("offers")
        .appendChild(document.createElement("div"));
    await settle(5100);
    expect(desk()).toHaveLength(1);
    // a notice appearing later becomes the anchor and the rate, with no second desk
    const notice = document.createElement("div");
    notice.innerHTML = "<span>Market tax 5%</span>";
    document.getElementById("market").prepend(notice);
    await settle(5100);
    expect(desk()).toHaveLength(1);
    expect(desk()[0].nextElementSibling).toBe(notice);
    expect(desk()[0].textContent).toContain("read off the page notice");
    window.history.pushState({}, "", "/profile");
    await settle(5100);
    expect(desk()).toHaveLength(0);
    window.history.pushState({}, "", "/market/equipments");
    await settle(5100);
    expect(desk()).toHaveLength(1);
  });
  it("reads the panel's item and the desk's item once each instead of looping between them", async () => {
    window.history.replaceState({}, "", "/market/equipments?item=jet");
    marketFixture();
    const runtime = marketRuntime({
      craftCollapsed: false,
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    app = await startLens(runtime);
    await settle();
    document
      .querySelector('[data-action="desk-pick"][data-code="boots5"]')
      .click();
    await settle(3000);
    expect(salesCalls(runtime, "jet")).toBe(1);
    expect(salesCalls(runtime, "boots5")).toBe(1);
    expect(app.metrics.scans).toBeLessThan(10);
  });
  it("retries a failing sales read after a pause, not on every scan", async () => {
    window.history.replaceState({}, "", "/market/equipments?item=jet");
    marketFixture();
    const runtime = marketRuntime({}, () => ({
      error: "http",
      message: "the API answered 503",
    }));
    app = await startLens(runtime);
    await settle(3000);
    expect(salesCalls(runtime, "jet")).toBe(1);
    expect(document.getElementById("scrap-sniper-bar").textContent).toContain(
      "sales read failed",
    );
    await settle(16_000);
    expect(salesCalls(runtime, "jet")).toBe(1); // inside the retry window, and nothing scanned
    await settle(15_000); // the 30 s discovery scan asks again, once
    expect(salesCalls(runtime, "jet")).toBe(2);
    expect(app.metrics.scans).toBeLessThan(12);
  });
  it("keeps a failed read of the panel's item reported while the desk's item reads fine", async () => {
    window.history.replaceState({}, "", "/market/equipments?item=jet");
    marketFixture();
    const runtime = marketRuntime(
      {
        craftCollapsed: false,
        craftRecipes: { boots5: { scraps: 10, steel: 2 } },
      },
      (msg) =>
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
    await settle();
    document
      .querySelector('[data-action="desk-pick"][data-code="boots5"]')
      .click();
    await settle(3000);
    expect(salesCalls(runtime, "boots5")).toBe(1);
    expect(document.getElementById("scrap-sniper-bar").textContent).toContain(
      "Resale: sales read failed",
    );
    expect(
      document.querySelector('[data-action="desk-pick"][data-code="boots5"]')
        .textContent,
    ).toBe("no price"); // its own read worked (no steel book in this fixture); jet's failure is not its
  });
  it("picks up a ledger written by another tab while the desk is open", async () => {
    window.history.replaceState({}, "", "/market/equipments");
    marketFixture();
    const runtime = marketRuntime({ craftCollapsed: false });
    let ledger = { version: 1, revision: 1, entries: [], tombstones: {} };
    const inner = runtime.sendMessage.getMockImplementation();
    runtime.sendMessage.mockImplementation(async (msg) =>
      msg.type === "ledgerGet"
        ? { ledger: structuredClone(ledger) }
        : inner(msg),
    );
    app = await startLens(runtime);
    await settle();
    const desk = () => document.getElementById("warera-plus-craft").textContent;
    expect(desk()).toContain("No crafts recorded yet");
    const at = new Date().toISOString();
    ledger = {
      version: 1,
      revision: 2,
      tombstones: {},
      entries: [
        {
          id: "other-tab-01",
          createdAt: at,
          updatedAt: at,
          code: "boots5",
          label: "from another tab",
          inputs: {
            scraps: 1,
            steel: 0,
            scrapPrice: 0.2,
            steelPrice: null,
            priceSource: "manual",
          },
          costBasis: 0.2,
          result: { rarity: null, stat: null, durability: null, note: "" },
          state: "crafted",
          listing: { price: null, at: null },
          sale: { proceeds: null, at: null, source: "manual" },
          notes: "",
        },
      ],
    };
    await settle(5100);
    expect(desk()).toContain("from another tab");
  });
  it("writes with the revision the desk rendered, not one refreshed in the window before the re-render, so the worker can drop the stale edit", async () => {
    window.history.replaceState({}, "", "/market/equipments");
    marketFixture();
    const runtime = marketRuntime({
      craftCollapsed: false,
      craftRecipes: { boots5: { scraps: 10, steel: 2 } },
    });
    const at = new Date().toISOString();
    const mine = {
      id: "mine-0001",
      createdAt: at,
      updatedAt: at,
      code: "boots5",
      label: "mine",
      inputs: {
        scraps: 10,
        steel: 2,
        scrapPrice: 0.2,
        steelPrice: 1.5,
        priceSource: "manual",
      },
      costBasis: 5,
      result: { rarity: null, stat: null, durability: null, note: "" },
      state: "crafted",
      listing: { price: null, at: null },
      sale: { proceeds: null, at: null, source: "manual" },
      notes: "",
    };
    let ledger = { version: 1, revision: 1, entries: [mine], tombstones: {} };
    const inner = runtime.sendMessage.getMockImplementation();
    const writes = [];
    runtime.sendMessage.mockImplementation(async (msg) => {
      if (msg.type === "ledgerGet") return { ledger: structuredClone(ledger) };
      if (msg.type === "ledgerSet") {
        writes.push(msg);
        // the worker: the entry is tombstoned at revision 2, so a base below 2 loses
        const dropped =
          msg.baseRevision < 2 ? msg.changed.map((e) => e.id) : [];
        return { ledger: structuredClone(ledger), merged: true, dropped };
      }
      return inner(msg);
    });
    app = await startLens(runtime);
    await settle();
    const keep = () =>
      document.querySelector(
        '[data-action="desk-ledger-move"][data-type="keep"][data-id="mine-0001"]',
      );
    expect(keep()).not.toBeNull();
    const reads = () =>
      runtime.sendMessage.mock.calls.filter(([m]) => m.type === "ledgerGet")
        .length;
    // another tab deletes the entry; this tab's next tick picks revision 2 up
    ledger = {
      version: 1,
      revision: 2,
      entries: [],
      tombstones: { "mine-0001": { at, revision: 2 } },
    };
    const before = reads();
    for (let t = 0; t < 5200 && reads() === before; t += 50)
      await vi.advanceTimersByTimeAsync(50);
    expect(reads()).toBe(before + 1);
    // the refresh landed, the re-render (100 ms) has not: the row is still on screen, rendered from revision 1
    expect(keep()).not.toBeNull();
    keep().click();
    await settle(400);
    expect(writes).toHaveLength(1);
    expect(writes[0].baseRevision).toBe(1);
    expect(writes[0].changed.map((e) => e.id)).toEqual(["mine-0001"]);
    expect(keep()).toBeNull();
    expect(document.getElementById("warera-plus-craft").textContent).toContain(
      "deleted in another tab meanwhile",
    );
  });
  it("keeps both panels in place and a focused desk field focused across native mutations", async () => {
    window.history.replaceState({}, "", "/market/equipments");
    marketFixture();
    app = await startLens(marketRuntime({ craftCollapsed: false }));
    await settle();
    const bar = document.getElementById("scrap-sniper-bar");
    const desk = document.getElementById("warera-plus-craft");
    const input = desk.querySelector('[data-field="scrapPrice"]');
    input.focus();
    expect(document.activeElement).toBe(input);
    for (let i = 0; i < 5; i++) {
      document
        .getElementById("offers")
        .appendChild(document.createElement("div"));
      await settle(1100);
    }
    expect(document.getElementById("scrap-sniper-bar")).toBe(bar);
    expect(document.getElementById("warera-plus-craft")).toBe(desk);
    expect(bar.nextElementSibling).toBe(desk);
    expect(document.activeElement).toBe(input);
  });
  it("survives repeated navigation away and back without duplicate panels or leaked nodes", async () => {
    window.history.replaceState({}, "", "/market/equipments");
    marketFixture();
    app = await startLens(marketRuntime({ craftCollapsed: false }));
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
      expect(document.querySelectorAll("#warera-plus-craft")).toHaveLength(1);
      expect(count()).toBe(first);
    }
    app.dispose();
    expect(count()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
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
