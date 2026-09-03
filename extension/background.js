// Scrap Sniper background service worker: the only place that holds the API
// key and talks to the API. The content script asks it for the scrap book;
// the settings page asks it to test a key or to open itself.
//
// The key lives in chrome.storage.local (this browser profile, this
// extension) and is sent only as the x-api-key header to api2.warera.io.
import { fetchBook, fetchSales } from './lib/api.mjs';

const DEFAULT_INTERVAL_SEC = 30;
const MIN_INTERVAL_SEC = 10;
const SALES_TTL_MS = 3 * 60 * 1000;   // one item's fills are re-read at most every 3 minutes
const SALES_HOURS = 72;
const SALES_MAX_PAGES = 5;            // 500 fills; a busy common item may not reach 72 h, and says so

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

  if (msg?.type === 'book') {
    const { settings = {}, book = null } = await chrome.storage.local.get(['settings', 'book']);
    const key = String(settings.apiKey ?? '').trim();
    if (!key) return { error: 'no-key', message: 'no API key set' };
    const intervalMs = Math.max(MIN_INTERVAL_SEC, Number(settings.intervalSec) || DEFAULT_INTERVAL_SEC) * 1000;
    if (!msg.force && book?.at && Date.now() - Date.parse(book.at) < intervalMs) return { book };
    try {
      const r = await fetchBook(fetch, key);
      const fresh = { ...r.book, at: new Date().toISOString(), limit: r.limit, remaining: r.remaining };
      await chrome.storage.local.set({ book: fresh });
      return { book: fresh };
    } catch (e) {
      if (e.code === 'key-rejected') {
        await chrome.storage.local.remove('book');
        return { error: 'key-rejected', message: e.message };
      }
      return { error: e.code ?? 'internal', message: e.message, book };
    }
  }

  if (msg?.type === 'sales') {
    const code = String(msg.itemCode ?? '');
    if (!/^[a-z0-9]{1,24}$/i.test(code)) return { error: 'bad-item', message: 'no item code' };
    const storeKey = `sales:${code}`;
    const got = await chrome.storage.local.get(['settings', storeKey]);
    const key = String(got.settings?.apiKey ?? '').trim();
    if (!key) return { error: 'no-key', message: 'no API key set' };
    const cached = got[storeKey] ?? null;
    if (!msg.force && cached?.at && Date.now() - Date.parse(cached.at) < SALES_TTL_MS) return { sales: cached };
    try {
      const r = await fetchSales(fetch, key, code, { hours: SALES_HOURS, maxPages: SALES_MAX_PAGES });
      const fresh = { code, hours: SALES_HOURS, fills: r.fills, pages: r.pages, complete: r.complete, at: new Date().toISOString() };
      await chrome.storage.local.set({ [storeKey]: fresh });
      return { sales: fresh };
    } catch (e) {
      if (e.code === 'key-rejected') return { error: 'key-rejected', message: e.message };
      return { error: e.code ?? 'internal', message: e.message, sales: cached };
    }
  }

  return { error: 'unknown-message', message: `unknown message type ${msg?.type}` };
}
