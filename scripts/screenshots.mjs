// Reproducible screenshots and browser measurements from synthetic fixtures.
//
//   node scripts/screenshots.mjs [--out docs/screenshots] [--before <old extension dir>]
//
// Serves the extension (and, with --before, an older copy of it) next to
// fixtures/market.html, boots the content app in headless Chromium with a
// mock runtime (synthetic quotes, fills and ledger; no API, no key), and
// captures the equipment market, the Craft Desk and the settings page at
// wide and narrow widths. The same page then runs the loader benchmark:
// mutation bursts against a 60-row list, counting layout-forcing reads.
//
// Needs Playwright and its Chromium: set PLAYWRIGHT_MODULE to the module
// path when it is not resolvable from this repository (there is no runtime
// dependency; this is a development script).
import http from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const outDir = resolve(root, opt("--out", "docs/screenshots"));
const beforeDir = opt("--before", null);
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".json": "application/json",
};
const roots = {
  "/ext/": resolve(root, "extension"),
  "/fixtures/": resolve(root, "fixtures"),
  ...(beforeDir ? { "/old/": resolve(root, beforeDir) } : {}),
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let file = null;
  if (/^\/market\/equipments\/?$/.test(url.pathname))
    file = resolve(root, "fixtures/market.html");
  else
    for (const [prefix, dir] of Object.entries(roots))
      if (url.pathname.startsWith(prefix))
        file = resolve(dir, "." + url.pathname.slice(prefix.length - 1));
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
await mkdir(outDir, { recursive: true });

// The mock runtime the content app talks to instead of the worker: one
// synthetic scrap book, resource books, 72 h of fills per item, a ledger.
const RUNTIME = `(() => {
  const NOW = Date.now();
  const iso = (msAgo = 0) => new Date(NOW - msAgo).toISOString();
  const levels = (price, n, step) => Array.from({ length: n }, (_, i) => ({ price: Number((price + i * step).toFixed(3)), quantity: 500 + i * 300 }));
  const book = (bid, ask) => ({ at: iso(), bid, ask, bidQty: 500, askQty: 500, bids: levels(bid, 8, -0.001), asks: levels(ask, 8, 0.001), bidCapped: false, askCapped: false });
  const BASE = { jet: 380, tank: 120, knife: 1.2, boots5: 130, helmet4: 42, chest2: 4.6 };
  let seed = 11;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const fillsFor = (code) => Array.from({ length: code === 'jet' ? 23 : code === 'knife' ? 4 : 9 }, (_, i) => ({ price: Number(((BASE[code] ?? 10) * (0.85 + rnd() * 0.3)).toFixed(3)), at: iso((i * 3 + rnd() * 2) * 3600e3), state: rnd() > 0.8 ? 60 + Math.round(rnd() * 40) : 100, code }));
  const settings = Object.assign({ minMarginPct: 0, intervalSec: 30, collapsed: true, casesCollapsed: true, roundTrip: false, equipment: true, cases: true, travel: true, picker: true, sellFrom: 'epic', craft: true, craftCollapsed: true, craftBatch: 5, craftTargetPct: 20, taxPct: null, craftRecipes: {}, schemaVersion: 3 }, window.__settings ?? {});
  const info = { settings, hasKey: true, revision: 1, authRevision: 1 };
  const entry = (id, code, state, extra) => ({ id, createdAt: iso(2 * 86400e3), updatedAt: iso(86400e3), code, label: '', inputs: { scraps: 270, steel: 4, scrapPrice: 0.221, steelPrice: 1.612, priceSource: 'inferred' }, costBasis: 270 * 0.221 + 4 * 1.612, result: { rarity: 'rare', stat: 48, durability: 100, note: 'synthetic entry' }, state, listing: { price: null, at: null }, sale: { proceeds: null, at: null, source: 'manual' }, notes: '', ...extra });
  let ledger = { version: 1, entries: [entry('fx00000001', 'chest3', 'sold', { listing: { price: 78, at: iso(80000e3) }, sale: { proceeds: 74.1, at: iso(40000e3), source: 'manual' } }), entry('fx00000002', 'chest3', 'listed', { listing: { price: 82.5, at: iso(30000e3) } })] };
  const books = { scraps: book(0.221, 0.224), steel: book(1.612, 1.655), oil: book(0.241, 0.249), woodenCase: book(7.4, 7.9), case1: book(3.4, 3.6), case2: book(21.5, 22.4) };
  window.__mock = { settings, ledger: () => ledger, calls: [] };
  return {
    sendMessage: async (msg) => {
      window.__mock.calls.push(msg.type);
      switch (msg.type) {
        case 'getSettings': return structuredClone(info);
        case 'saveSettings': Object.assign(settings, msg.settings); info.revision++; return structuredClone(info);
        case 'book': return { book: books.scraps };
        case 'cases': return { cases: { at: iso(), books } };
        case 'avg': return { avg: { at: iso(), values: {}, times: {}, failures: {} } };
        case 'sales': return { sales: { code: msg.itemCode, hours: 72, at: iso(), complete: msg.itemCode !== 'jet', fills: fillsFor(msg.itemCode) } };
        case 'ledgerGet': return { ledger: structuredClone(ledger) };
        case 'ledgerSet': ledger = { version: 1, entries: msg.ledger.entries }; return { ledger: structuredClone(ledger) };
        default: return {};
      }
    },
  };
})()`;
const COUNTERS = `(() => {
  const c = (window.__counters = { innerText: 0, getComputedStyle: 0, querySelectorAll: 0 });
  const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
  Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { c.innerText++; return d.get.call(this); }, set: d.set });
  const gcs = window.getComputedStyle;
  window.getComputedStyle = function (...a) { c.getComputedStyle++; return gcs.apply(this, a); };
  for (const proto of [Document.prototype, Element.prototype]) {
    const q = proto.querySelectorAll;
    proto.querySelectorAll = function (...a) { c.querySelectorAll++; return q.apply(this, a); };
  }
})()`;

const browser = await chromium.launch({ headless: true });
async function openMarket({
  prefix = "/ext",
  width = 1280,
  query = "item=jet",
  settings = {},
}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.addInitScript(
    `window.__settings = ${JSON.stringify(settings)}; ${COUNTERS}`,
  );
  await page.goto(`${base}/market/equipments?${query}`, { waitUntil: "load" });
  await page.addStyleTag({ url: `${prefix}/content.css` });
  await page.evaluate(
    `(async () => { const runtime = ${RUNTIME}; const { startLens } = await import('${prefix}/lib/app.mjs'); window.__app = await startLens(runtime); })()`,
  );
  await page.waitForTimeout(700);
  return page;
}
async function shot(page, name, selector = null) {
  const path = resolve(outDir, `${name}.png`);
  if (selector) await page.locator(selector).first().screenshot({ path });
  else await page.screenshot({ path, fullPage: true });
  console.log(`  ${name}.png`);
}
async function openPopup(prefix, width, { advanced = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.addInitScript(
    `window.chrome = { runtime: { getManifest: () => ({ version: '${prefix === "/old" ? "1.4.1" : "1.6.0"}' }), sendMessage: async (m) => m.type === 'getSettings' ? { settings: { craftRecipes: { jet: { scraps: 1, steel: 1 }, boots5: { scraps: 1, steel: 1 } } }, hasKey: true, revision: 1, authRevision: 1 } : { settings: {} } } };`,
  );
  await page.goto(`${base}${prefix}/popup.html`, { waitUntil: "networkidle" });
  if (advanced)
    await page.evaluate(
      "document.getElementById('advanced')?.setAttribute('open', '')",
    );
  await page.waitForTimeout(200);
  return page;
}

console.log("after:");
{
  const page = await openMarket({ width: 1280 });
  await shot(page, "market-compact-wide");
  await page.locator("#scrap-sniper-bar [data-action='collapse']").click();
  await page.locator(".ss-verdict [data-action='details']").first().click();
  await page.waitForTimeout(400);
  await shot(page, "market-details-wide");
  await page.close();
}
{
  const page = await openMarket({ width: 420 });
  await page.locator(".ss-verdict [data-action='details']").first().click();
  await page.waitForTimeout(400);
  await shot(page, "market-details-narrow");
  await page.close();
}
{
  // The desk ships the game's recipe table, so the screenshots need none.
  for (const width of [1280, 420]) {
    const page = await openMarket({
      width,
      settings: { craftCollapsed: false },
    });
    await page.locator("[data-action='desk-pick'][data-code='jet']").click();
    await page.waitForTimeout(600);
    await shot(
      page,
      `craftdesk-${width === 1280 ? "wide" : "narrow"}`,
      "#warera-plus-craft",
    );
    if (width === 1280)
      await shot(page, "ledger-wide", "#warera-plus-craft .lens-ledger-box");
    await page.close();
  }
}
for (const width of [320, 380, 560]) {
  const page = await openPopup("/ext", width, { advanced: width === 560 });
  await shot(page, `popup-${width}`);
  await page.close();
}
if (beforeDir) {
  console.log("before:");
  for (const [name, width] of [
    ["before-market-wide", 1280],
    ["before-market-narrow", 420],
  ]) {
    const page = await openMarket({
      prefix: "/old",
      width,
      settings: { collapsed: false },
    });
    await shot(page, name);
    await page.close();
  }
  for (const width of [320, 380]) {
    const page = await openPopup("/old", width);
    await shot(page, `before-popup-${width}`);
    await page.close();
  }
}

// Loader benchmark: the same 60-row fixture, the same 40 native mutation
// bursts, for each build. Counters are reset after the first scans settle.
async function bench(prefix) {
  const page = await openMarket({
    prefix,
    width: 1280,
    query: "item=jet&rows=60",
  });
  await page.waitForTimeout(1500);
  const read = () =>
    page.evaluate(
      "({ scans: window.__app.metrics.scans, scanMs: window.__app.metrics.scanMs, maxScanMs: window.__app.metrics.maxScanMs, ...window.__counters, equipment: window.__app.metrics.equipment ? { ...window.__app.metrics.equipment, innerTextReads: window.__app.metrics.equipment.innerTextReads } : null })",
    );
  const start = await read();
  const quietStart = Date.now();
  await page.waitForTimeout(3000);
  const quiet = await read();
  const quietMs = Date.now() - quietStart;
  await page.evaluate(
    `(async () => { for (let i = 0; i < 40; i++) { for (let k = 0; k < 3; k++) document.getElementById('offers').appendChild(document.createElement('div')); await new Promise((r) => setTimeout(r, 150)); } })()`,
  );
  await page.waitForTimeout(500);
  const end = await read();
  await page.close();
  const delta = (a, b, k) => b[k] - a[k];
  return {
    build: prefix === "/old" ? "before (1.4.1)" : "after (1.6.0)",
    rows: 60,
    quiet3s: {
      scans: delta(start, quiet, "scans"),
      ms: quietMs,
    },
    bursts40: {
      scans: delta(quiet, end, "scans"),
      scanMs: Number(delta(quiet, end, "scanMs").toFixed(1)),
      maxScanMs: Number(end.maxScanMs.toFixed(1)),
      innerTextReads: delta(quiet, end, "innerText"),
      getComputedStyle: delta(quiet, end, "getComputedStyle"),
      querySelectorAll: delta(quiet, end, "querySelectorAll"),
    },
    equipment: end.equipment,
  };
}
const results = [await bench("/ext")];
if (beforeDir) results.unshift(await bench("/old"));
await mkdir(resolve(root, "docs/perf"), { recursive: true });
await writeFile(
  resolve(root, "docs/perf/browser.json"),
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      engine: "Chromium headless via Playwright",
      fixture: "fixtures/market.html?item=jet&rows=60",
      results,
    },
    null,
    2,
  ),
);
console.log("browser benchmark:");
for (const r of results)
  console.log(
    `  ${r.build}: ${r.bursts40.scans} scans in ${r.bursts40.scanMs} ms (max ${r.bursts40.maxScanMs} ms) · innerText ${r.bursts40.innerTextReads} · getComputedStyle ${r.bursts40.getComputedStyle} · querySelectorAll ${r.bursts40.querySelectorAll} · quiet 3 s: ${r.quiet3s.scans} scans`,
  );
await browser.close();
server.close();
