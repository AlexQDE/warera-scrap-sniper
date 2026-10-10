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
    expect(bodyText()).toContain("Best slot");
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
    expect(bodyText()).toContain("Best slot");
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
