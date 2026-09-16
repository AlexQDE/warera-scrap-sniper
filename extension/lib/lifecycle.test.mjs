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
  it("keeps market books when details are opened and loads averages only on demand", async () => {
    const runtime = mockRuntime();
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
