// Scrap Sniper background service worker: the only place that holds the API
// key and talks to the API. The content script asks it for the scrap book;
// the settings page asks it to test a key or to open itself.
//
// The key lives in chrome.storage.local (this browser profile, this
// extension) and is sent only as the x-api-key header to api2.warera.io.
//
// Reads are single-flight: concurrent asks for the same thing (two tabs
// ticking, a tick racing the refresh button, two tabs on the same item) share
// one call. After a 429 the API is left alone until the reset it named and
// the cache is served with a rate-limited message; the content tick is the
// retry clock, there is no timer here.
import { fetchBook, fetchSales, fetchBooks, fetchEquipmentAvg, holdUntil } from './lib/api.mjs';
import { makeSingleFlight } from './lib/flight.mjs';
import { CASE_CODES, WOODEN_CODES, ALL_GEAR_CODES } from './lib/cases.mjs';

const DEFAULT_INTERVAL_SEC = 30;
const MIN_INTERVAL_SEC = 10;
const SALES_TTL_MS = 3 * 60 * 1000;   // one item's fills are re-read at most every 3 minutes
const SALES_HOURS = 72;
const SALES_MAX_PAGES = 5;            // 500 fills; a busy common item may not reach 72 h, and says so
const CASES_TTL_MS = 60 * 1000;       // the case books (one call: 3 cases, 20 resources, scraps, oil)
const AVG_TTL_MS = 10 * 60 * 1000;    // the game's "Current value" of the 36 gear codes (two batched calls)
const CASES_BOOK_CODES = [...CASE_CODES, ...WOODEN_CODES, 'scraps', 'oil'];

const once = makeSingleFlight();
let apiHoldUntil = 0;   // ms; after a 429 nothing is asked before this. Lost when the worker sleeps, which only costs one early retry.

const held = () => Date.now() < apiHoldUntil;
const holdMessage = () => `rate limited by the API, next read in ${Math.max(1, Math.ceil((apiHoldUntil - Date.now()) / 1000))} s`;
const noteRateLimit = (e) => { if (e?.code === 'rate-limited') apiHoldUntil = holdUntil(e.retryAfter); };

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ error: 'internal', message: e?.message ?? String(e) }));
  return true; // answered asynchronously
});

async function handle(msg) {
  if (msg?.type === 'openSettings') {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  }

  if (msg?.type === 'testKey') {
    try {
      const r = await fetchBook(fetch, msg.key);
      return { ok: true, ask: r.book.ask, bid: r.book.bid, limit: r.limit, remaining: r.remaining };
    } catch (e) {
      return { ok: false, error: e.code ?? 'internal', message: e.message };
    }
  }

  // A forced read gets its own key so the refresh button never joins a run
  // that is about to answer from the cache.
  if (msg?.type === 'book') return once(msg.force ? 'book!' : 'book', () => readBook(!!msg.force));

  if (msg?.type === 'sales') {
    const code = String(msg.itemCode ?? '');
    if (!/^[a-z0-9]{1,24}$/i.test(code)) return { error: 'bad-item', message: 'no item code' };
    return once(`sales:${code}${msg.force ? '!' : ''}`, () => readSales(code, !!msg.force));
  }

  if (msg?.type === 'cases') return once(msg.force ? 'cases!' : 'cases', () => readCases(!!msg.force));

  return { error: 'unknown-message', message: `unknown message type ${msg?.type}` };
}

/**
 * The cases read: every price the case strip and the trip line need in one
 * book call (sealed cases, the 20 wooden-case resources, scraps, oil), plus
 * the game's average item price per gear code every 10 minutes. The averages
 * are the upside of an open; when they cannot be read the strip falls back
 * to the scrap floor and says so, it never blocks on them.
 */
async function readCases(force) {
  const { settings = {}, cases = null } = await chrome.storage.local.get(['settings', 'cases']);
  const key = String(settings.apiKey ?? '').trim();
  if (!key) return { error: 'no-key', message: 'no API key set' };
  if (!force && cases?.at && Date.now() - Date.parse(cases.at) < CASES_TTL_MS) return { cases };
  if (held()) return { error: 'rate-limited', message: holdMessage(), cases };
  try {
    const r = await fetchBooks(fetch, key, CASES_BOOK_CODES);
    let { avg = null, avgAt = null, avgError = null } = cases ?? {};
    if (force || !avgAt || Date.now() - Date.parse(avgAt) > AVG_TTL_MS) {
      try {
        const a = await fetchEquipmentAvg(fetch, key, ALL_GEAR_CODES);
        avg = a.avg;
        avgAt = new Date().toISOString();
        avgError = null;
      } catch (e) {
        noteRateLimit(e);
        if (e.code === 'key-rejected') throw e;
        avgError = e.message;   // the old averages stay, the strip says how old they are
      }
    }
    const fresh = { at: new Date().toISOString(), books: r.books, source: r.source, avg, avgAt, avgError, limit: r.limit, remaining: r.remaining };
    await chrome.storage.local.set({ cases: fresh });
    return { cases: fresh };
  } catch (e) {
    noteRateLimit(e);
    if (e.code === 'key-rejected') {
      await chrome.storage.local.remove('cases');
      return { error: 'key-rejected', message: e.message };
    }
    return { error: e.code ?? 'internal', message: e.message, cases };
  }
}

async function readBook(force) {
  const { settings = {}, book = null } = await chrome.storage.local.get(['settings', 'book']);
  const key = String(settings.apiKey ?? '').trim();
  if (!key) return { error: 'no-key', message: 'no API key set' };
  const intervalMs = Math.max(MIN_INTERVAL_SEC, Number(settings.intervalSec) || DEFAULT_INTERVAL_SEC) * 1000;
  if (!force && book?.at && Date.now() - Date.parse(book.at) < intervalMs) return { book };
  if (held()) return { error: 'rate-limited', message: holdMessage(), book };
  try {
    const r = await fetchBook(fetch, key);
    const fresh = { ...r.book, at: new Date().toISOString(), limit: r.limit, remaining: r.remaining };
    await chrome.storage.local.set({ book: fresh });
    return { book: fresh };
  } catch (e) {
    noteRateLimit(e);
    if (e.code === 'key-rejected') {
      await chrome.storage.local.remove('book');
      return { error: 'key-rejected', message: e.message };
    }
    return { error: e.code ?? 'internal', message: e.message, book };
  }
}

async function readSales(code, force) {
  const storeKey = `sales:${code}`;
  const got = await chrome.storage.local.get(['settings', storeKey]);
  const key = String(got.settings?.apiKey ?? '').trim();
  if (!key) return { error: 'no-key', message: 'no API key set' };
  const cached = got[storeKey] ?? null;
  if (!force && cached?.at && Date.now() - Date.parse(cached.at) < SALES_TTL_MS) return { sales: cached };
  if (held()) return { error: 'rate-limited', message: holdMessage(), sales: cached };
  try {
    const r = await fetchSales(fetch, key, code, { hours: SALES_HOURS, maxPages: SALES_MAX_PAGES });
    const fresh = { code, hours: SALES_HOURS, fills: r.fills, pages: r.pages, complete: r.complete, at: new Date().toISOString() };
    await chrome.storage.local.set({ [storeKey]: fresh });
    return { sales: fresh };
  } catch (e) {
    noteRateLimit(e);
    if (e.code === 'key-rejected') return { error: 'key-rejected', message: e.message };
    return { error: e.code ?? 'internal', message: e.message, sales: cached };
  }
}
