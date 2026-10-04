// Loader diagnostics in jsdom (no layout engine: counts DOM work, not paint
// or layout cost). The browser figures come from scripts/screenshots.mjs.
//
//   node scripts/bench-loader.mjs [--before <old extension dir>]
//
// Builds fixtures/market.html with 60 rows, boots the content app against
// the same mock runtime shape, then fires 40 native mutation bursts and
// counts scans, innerText reads, getComputedStyle and querySelectorAll calls.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const i = args.indexOf("--before");
const beforeDir = i >= 0 ? resolve(root, args[i + 1]) : null;
const html = await readFile(resolve(root, "fixtures/market.html"), "utf8");

async function run(extensionDir) {
  const dom = new JSDOM(html, {
    url: "https://app.warera.io/market/equipments?item=jet&rows=60",
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const counters = { innerText: 0, getComputedStyle: 0, querySelectorAll: 0 };
  // jsdom has no innerText: give block children their own lines, like layout would.
  Object.defineProperty(window.HTMLElement.prototype, "innerText", {
    configurable: true,
    get() {
      counters.innerText++;
      const lines = [];
      for (const node of this.childNodes)
        lines.push(
          node.nodeType === 3 ? node.textContent : (node.innerText ?? ""),
        );
      return lines.join("\n");
    },
  });
  const gcs = window.getComputedStyle;
  window.getComputedStyle = (...a) => {
    counters.getComputedStyle++;
    return gcs.apply(window, a);
  };
  for (const proto of [window.Document.prototype, window.Element.prototype]) {
    const q = proto.querySelectorAll;
    proto.querySelectorAll = function (...a) {
      counters.querySelectorAll++;
      return q.apply(this, a);
    };
  }
  Object.assign(globalThis, {
    window,
    document: window.document,
    location: window.location,
    getComputedStyle: window.getComputedStyle,
    MutationObserver: window.MutationObserver,
    Event: window.Event,
    HTMLElement: window.HTMLElement,
    Node: window.Node,
    URL: window.URL,
    Blob: window.Blob,
  });
  const NOW = Date.now();
  const iso = () => new Date(NOW).toISOString();
  const settings = {
    minMarginPct: 0,
    intervalSec: 30,
    collapsed: true,
    casesCollapsed: true,
    roundTrip: false,
    equipment: true,
    cases: true,
    travel: true,
    picker: true,
    sellFrom: "epic",
    craft: true,
    craftCollapsed: true,
    craftBatch: 1,
    craftTargetPct: 20,
    taxPct: null,
    craftRecipes: {},
  };
  const info = { settings, hasKey: true, revision: 1, authRevision: 1 };
  const runtime = {
    sendMessage: async (msg) => {
      if (msg.type === "getSettings") return structuredClone(info);
      if (msg.type === "book")
        return {
          book: {
            at: iso(),
            bid: 0.221,
            ask: 0.224,
            bids: [{ price: 0.221, quantity: 1e5 }],
            asks: [{ price: 0.224, quantity: 1e5 }],
          },
        };
      if (msg.type === "sales")
        return {
          sales: {
            code: msg.itemCode,
            at: iso(),
            complete: true,
            fills: Array.from({ length: 12 }, (_, k) => ({
              price: 370 + k,
              at: new Date(NOW - k * 3600e3).toISOString(),
              state: 100,
              code: msg.itemCode,
            })),
          },
        };
      if (msg.type === "cases") return { cases: { at: iso(), books: {} } };
      if (msg.type === "ledgerGet")
        return { ledger: { version: 1, entries: [] } };
      return {};
    },
  };
  const { startLens } = await import(
    pathToFileURL(resolve(extensionDir, "lib/app.mjs")).href +
      `?t=${Date.now()}`
  );
  const app = await startLens(runtime);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(800);
  const snap = () => ({
    scans: app.metrics.scans,
    scanMs: app.metrics.scanMs,
    ...counters,
  });
  const a = snap();
  const offers = window.document.getElementById("offers");
  for (let n = 0; n < 40; n++) {
    for (let k = 0; k < 3; k++)
      offers.appendChild(window.document.createElement("div"));
    await wait(150);
  }
  await wait(300);
  const b = snap();
  app.dispose();
  window.close();
  return {
    build: extensionDir === beforeDir ? "before (1.4.1)" : "after (1.6.0)",
    rows: 60,
    bursts40: {
      scans: b.scans - a.scans,
      scanMs: Number((b.scanMs - a.scanMs).toFixed(1)),
      innerTextReads: b.innerText - a.innerText,
      getComputedStyle: b.getComputedStyle - a.getComputedStyle,
      querySelectorAll: b.querySelectorAll - a.querySelectorAll,
    },
    equipment: app.metrics.equipment
      ? {
          scopedScans: app.metrics.equipment.scopedScans,
          fullScans: app.metrics.equipment.fullScans,
          rowsWritten: app.metrics.equipment.rowsWritten,
        }
      : null,
  };
}

const results = [];
if (beforeDir) results.push(await run(beforeDir));
results.push(await run(resolve(root, "extension")));
await mkdir(resolve(root, "docs/perf"), { recursive: true });
await writeFile(
  resolve(root, "docs/perf/jsdom.json"),
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      engine: "jsdom (diagnostic: no layout, innerText shimmed)",
      fixture: "fixtures/market.html?item=jet&rows=60",
      results,
    },
    null,
    2,
  ),
);
for (const r of results)
  console.log(
    `${r.build}: ${r.bursts40.scans} scans in ${r.bursts40.scanMs} ms · innerText ${r.bursts40.innerTextReads} · getComputedStyle ${r.bursts40.getComputedStyle} · querySelectorAll ${r.bursts40.querySelectorAll}`,
  );
process.exit(0);
