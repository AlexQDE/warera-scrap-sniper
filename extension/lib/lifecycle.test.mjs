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

  const marketFixture = () => {
    document.body.innerHTML =
      '<main><div id="tax"><span>Market tax 5%</span></div><div><div id="item-code-selector-jet" style="z-index:1;border-color:rgb(57,15,16)"></div><div id="item-code-selector-boots5" style="border-color:rgb(43,43,18)"></div></div><div id="offers"></div></main>';
  };
  /** A feed with one held legendary boots craft, so the Ledger asks for the boots' fills. */
  const craftsFor = (userId) => ({
    crafts: {
      userId,
      username: "Tester",
      at: new Date().toISOString(),
      days: 7,
      complete: { crafts: true, sales: true, dismantles: true },
      crafts: [
        {
          id: "held-boots-1",
          code: "boots5",
          skills: { dodge: 38 },
          at: new Date(Date.now() - 3600e3).toISOString(),
          scraps: 486,
        },
      ],
      sales: [],
      dismantles: [],
      averages: {},
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
      if (msg.type === "crafts") return craftsFor(msg.userId);
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
    expect(bodyText()).toContain("Random EV");
    expect(
      runtime.sendMessage.mock.calls.filter(([m]) => m.type === "avg"),
    ).toHaveLength(1); // the rows and the board are valued at the game's averages
    expect(
      runtime.sendMessage.mock.calls.filter(([m]) => m.type === "crafts"),
    ).toHaveLength(0); // the feed is read only with the Ledger open
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
    expect(bodyText()).toContain("Random EV");
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
  it("reads the grid's item and the ledger's held item once each instead of looping between them", async () => {
    window.history.replaceState({}, "", "/market/equipments?item=jet");
    marketFixture();
    const runtime = marketRuntime({ panel: "ledger", userId: ME });
    app = await startLens(runtime);
    await settle(3000);
    expect(
      runtime.sendMessage.mock.calls.filter(([m]) => m.type === "crafts"),
    ).toHaveLength(1);
    expect(bodyText()).toContain("Tester");
    expect(salesCalls(runtime, "jet")).toBe(1);
    expect(salesCalls(runtime, "boots5")).toBe(1);
    expect(app.metrics.scans).toBeLessThan(10);
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
    expect(bodyText()).toContain("needs 5 recent sales"); // its own read worked, empty
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
