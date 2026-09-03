// Scrap dashboard: a local page (and a terminal table) that watches the scrap
// order book and prints, per rarity, what a piece of gear is worth dismantled.
//
//   node dashboard/scrapdash.mjs                 # http://127.0.0.1:8765
//   node dashboard/scrapdash.mjs --port 9000
//   node dashboard/scrapdash.mjs --interval 30   # seconds between book reads (default 20, min 5)
//   node dashboard/scrapdash.mjs --once          # one read, print the table, exit
//
// The maths: scrap value = scraps x the scrap price (lowest sell order),
// compared with the gear price exactly as the market shows it. No tax anywhere.
//
// Read-only. One tradingOrder.getTopOrders call per interval. Works without
// any API key (100 requests a minute are allowed keyless, this uses 3). If
// WARERA_API_KEY is set in the environment or in a .env file next to
// package.json, it is sent as the x-api-key header and the limit is 200.
// The key never reaches the browser: the page only talks to this process.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RARITIES, summarizeBook, scrapTable } from '../extension/lib/scraplib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const LIB = join(ROOT, 'extension', 'lib');
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : def;
};
const PORT = Number(flag('--port', 8765));
const INTERVAL = Math.max(5, Number(flag('--interval', 20)));
const ONCE = argv.includes('--once');
const KEEP_TICKS = 24 * 60 * 60 * 1000; // a day of history in memory and on the page

const DATA = join(ROOT, 'data');
if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
const TICKS = join(DATA, 'scrap-ticks.ndjson');

// ---------- the API key (optional) ----------
function readKey() {
  const clean = (s) => String(s ?? '').replace(/^\s*['"]?|['"]?\s*$/g, '').trim();
  if (process.env.WARERA_API_KEY) return clean(process.env.WARERA_API_KEY);
  try {
    const lines = readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l.trim().startsWith('WARERA_API_KEY='));
    const line = lines[lines.length - 1];
    if (line) return clean(line.slice(line.indexOf('=') + 1));
  } catch {
    /* no .env: keyless is fine */
  }
  return '';
}
const KEY = readKey();
console.log(KEY ? '  using your API key (200 requests/min)' : '  no API key found, reading keyless (100 requests/min, plenty for this)');

// ---------- a minimal tRPC-over-GET client ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function trpc(path, input) {
  const url = `https://api2.warera.io/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`;
  let err;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url, { headers: KEY ? { 'x-api-key': KEY } : {} });
      if (res.status === 429) {
        const wait = Math.max(2, Number(res.headers.get('ratelimit-reset') || res.headers.get('retry-after') || 60));
        console.warn(`  ! rate limited, waiting ${wait}s`);
        await sleep(wait * 1000);
        continue;
      }
      const json = await res.json();
      if (json?.error) throw new Error(json.error.message || 'trpc error');
      return json?.result?.data;
    } catch (e) {
      err = e;
      await sleep(Math.min(30000, 750 * 2 ** i));
    }
  }
  throw err ?? new Error('gave up');
}

// ---------- state ----------
const readTicks = () => {
  if (!existsSync(TICKS)) return [];
  return readFileSync(TICKS, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
};
const state = { at: null, error: null, interval: INTERVAL, book: null, ticks: [] };
const sinceCutoff = () => Date.now() - KEEP_TICKS;
state.ticks = readTicks().filter((t) => t?.at && Date.parse(t.at) >= sinceCutoff());
if (state.ticks.length) console.log(`  loaded ${state.ticks.length} ticks from ${TICKS}`);

async function poll() {
  try {
    const raw = await trpc('tradingOrder.getTopOrders', { itemCode: 'scraps', limit: 100 });
    const book = summarizeBook(raw);
    const at = new Date().toISOString();
    const tick = { at, bid: book.bid, ask: book.ask, bidQty: book.bidQty, askQty: book.askQty, bidDepthQty: book.bidDepthQty, askDepthQty: book.askDepthQty };
    appendFileSync(TICKS, `${JSON.stringify(tick)}\n`);
    state.ticks.push(tick);
    const cut = sinceCutoff();
    while (state.ticks.length && Date.parse(state.ticks[0].at) < cut) state.ticks.shift();
    state.book = book;
    state.at = at;
    state.error = null;
  } catch (e) {
    state.error = `${new Date().toISOString()} ${e.message}`;
    console.warn(`  ! book read failed: ${e.message}`);
  }
}

// ---------- --once: print and leave ----------
const money = (v, d = 3) => (v == null ? '-' : v.toFixed(d));
if (ONCE) {
  await poll();
  if (!state.book) {
    console.error(`  no book: ${state.error}`);
    process.exit(1);
  }
  const b = state.book;
  const cap = (c) => (c ? ', top 100 shown' : '');
  console.log(`\n  SCRAPS  ${state.at.slice(0, 19).replace('T', ' ')} UTC`);
  console.log(`  scrap price ${money(b.ask)} (lowest ask, ${b.askQty} for sale${cap(b.askCapped)})   best bid ${money(b.bid)} (${b.bidQty} wanted${cap(b.bidCapped)})   spread ${money(b.spread)}\n`);
  console.log(`  ${'rarity'.padEnd(10)} ${'scraps'.padStart(7)} ${'scrap value'.padStart(12)} ${'at bid'.padStart(9)}`);
  for (const r of scrapTable({ bid: b.bid, ask: b.ask })) {
    console.log(`  ${r.rarity.padEnd(10)} ${String(r.yield).padStart(7)} ${money(r.valueAtAsk).padStart(12)} ${money(r.valueAtBid).padStart(9)}`);
  }
  console.log('\n  scrap value = scraps x scrap price; compare with the gear price exactly as the market shows it.');
  process.exit(0);
}

// ---------- server ----------
const MIME = { html: 'text/html; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8' };
const STATIC = {
  '/': { file: join(HERE, 'scrapdash.html'), type: MIME.html },
  '/scraplib.mjs': { file: join(LIB, 'scraplib.mjs'), type: MIME.mjs },
  '/ladder.mjs': { file: join(LIB, 'ladder.mjs'), type: MIME.mjs },
};
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  try {
    if (path === '/api/state') {
      res.writeHead(200, { 'content-type': MIME.json, 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ...state, rarities: RARITIES, now: new Date().toISOString() }));
    }
    const hit = STATIC[path];
    if (!hit) {
      res.writeHead(404);
      return res.end('not found');
    }
    const body = await readFile(hit.file);
    res.writeHead(200, { 'content-type': hit.type, 'cache-control': 'no-store' });
    res.end(body);
  } catch (e) {
    res.writeHead(500);
    res.end(String(e.message));
  }
});

await poll();
setInterval(poll, INTERVAL * 1000);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  scrap dashboard  ->  http://127.0.0.1:${PORT}`);
  console.log(`  reading the scrap book every ${INTERVAL}s`);
  console.log('  Ctrl+C to stop\n');
});
