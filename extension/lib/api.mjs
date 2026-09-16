// The API calls the extension makes, and the rule that they are made only
// with the player's own key.
//
// Probed 2026-09-03: api2 does not refuse a wrong key. It answers the request
// from the keyless bucket (ratelimit-limit 100) as if no key were sent; an
// accepted key gets a bigger bucket (500). So whether the key was accepted is
// read off the ratelimit-limit header, and an answer from the keyless bucket
// is treated as a rejected key and its data discarded. Nothing here is ever
// read without an accepted key.
import { summarizeBook } from './scraplib.mjs';

const TRPC = 'https://api2.warera.io/trpc/';
const withInput = (proc, input) => `${TRPC}${proc}?input=${encodeURIComponent(JSON.stringify(input))}`;

export const BOOK_URL = withInput('tradingOrder.getTopOrders', { itemCode: 'scraps', limit: 100 });
export const KEYLESS_LIMIT = 100;
export const TIMEOUT_MS = 10_000;   // a call that has not answered by then is given up, not left hanging

/**
 * When the API answers 429, the moment (ms) before which nothing is asked
 * again: the reset it names, never under 5 s (do not hammer), never over
 * 120 s (a bad header must not park the toolbar), 60 s when it names none.
 */
export function holdUntil(retryAfterSec, now = Date.now()) {
  const s = Number(retryAfterSec);
  const sec = Number.isFinite(s) && s > 0 ? Math.min(120, Math.max(5, s)) : 60;
  return now + sec * 1000;
}

/** One item's market fills, newest first, 100 a page (openapi: itemCode is a documented filter). */
export const salesUrl = (itemCode, cursor) => withInput('transaction.getPaginatedTransactions', {
  transactionType: 'itemMarket', itemCode, limit: 100, ...(cursor ? { cursor } : {}),
});

export class ApiError extends Error {
  constructor(message, code, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

const header = (res, name) => {
  const v = Number(res.headers?.get?.(name));
  return Number.isFinite(v) ? v : null;
};

const cleanKey = (key) => {
  const k = String(key ?? '').trim();
  if (!k) throw new ApiError('no API key set', 'no-key');
  return k;
};

/**
 * One keyed GET; resolves the tRPC `result.data` or throws a typed ApiError
 * (no-key | key-rejected | rate-limited | http | api | timeout | network).
 * The call is abandoned after `timeoutMs`, headers and body alike.
 */
async function call(fetchImpl, key, url, { timeoutMs = TIMEOUT_MS, batch = false } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await request(fetchImpl, key, url, ctl.signal, batch);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (ctl.signal.aborted) throw new ApiError(`the API did not answer within ${Math.round(timeoutMs / 1000)} s`, 'timeout');
    throw new ApiError(`could not reach the API: ${e?.message ?? e}`, 'network');
  } finally {
    clearTimeout(timer);
  }
}

async function request(fetchImpl, key, url, signal, batch = false) {
  const res = await fetchImpl(url, { headers: { 'x-api-key': key }, signal });
  const limit = header(res, 'ratelimit-limit');
  const remaining = header(res, 'ratelimit-remaining');
  if (res.status === 429) throw new ApiError('rate limited by the API', 'rate-limited', { status: 429, retryAfter: header(res, 'ratelimit-reset') ?? 60 });
  if (!res.ok) throw new ApiError(`the API answered ${res.status}`, 'http', { status: res.status });
  if (limit != null && limit <= KEYLESS_LIMIT) {
    throw new ApiError('the API did not accept this key (it answered as if none were sent)', 'key-rejected', { status: res.status, limit });
  }
  const json = await res.json();
  if (batch) return { data: json, limit, remaining };   // a batch answers an array, one envelope per slot; slot errors are read by the caller
  if (json?.error) throw new ApiError(`API error: ${json.error.message || 'unknown'}`, 'api', { status: res.status });
  return { data: json?.result?.data, limit, remaining };
}

/**
 * Read the scrap order book with `key`. Resolves { book, limit, remaining };
 * rejects with an ApiError whose `code` is one of
 * no-key | key-rejected | rate-limited | http | api | timeout | network.
 */
export async function fetchBook(fetchImpl, key, { timeoutMs = TIMEOUT_MS } = {}) {
  const k = cleanKey(key);
  const { data, limit, remaining } = await call(fetchImpl, k, BOOK_URL, { timeoutMs });
  return { book: summarizeBook(data), limit, remaining };
}

/**
 * Walk one item's market fills back `hours` (default 72), at most `maxPages`
 * pages of 100. Resolves { fills: [{ price, at, state, code }], pages,
 * complete } where `complete` says the window was covered (or the feed ended)
 * rather than the page cap being hit.
 */
export async function fetchSales(fetchImpl, key, itemCode, { hours = 72, maxPages = 5, now = Date.now(), timeoutMs = TIMEOUT_MS } = {}) {
  const k = cleanKey(key);
  const cutoff = now - hours * 3600e3;
  const fills = [];
  let cursor;
  let pages = 0;
  let complete = false;
  while (pages < maxPages) {
    const { data } = await call(fetchImpl, k, salesUrl(itemCode, cursor), { timeoutMs });
    pages++;
    const items = Array.isArray(data?.items) ? data.items : [];
    for (const it of items) {
      const at = Date.parse(it?.createdAt);
      const price = Number(it?.money);
      if (Number.isNaN(at) || !Number.isFinite(price)) continue;   // a malformed row is skipped; only a real timestamp can end the walk
      if (at < cutoff) { complete = true; break; }
      fills.push({ price, at: it.createdAt, state: it.item?.state ?? null, code: it.item?.code ?? it.itemCode });
    }
    if (complete) break;
    if (!data?.nextCursor || items.length === 0) { complete = true; break; }
    cursor = data.nextCursor;
  }
  return { fills, pages, complete };
}

// ---------------------------------------------------------------- v0.26 cases -
// Two procedures the game client uses that openapi.json does not list (probed
// 2026-09-16, both answer an accepted key from the 500 bucket; the editor
// chose to use them): tradingOrder.getTopOrdersPerItemCode reads every code's
// book in one call, gameStat.getEquipmentAvgByCode is the "Current value" the
// game prints on a tile. The documented tradingOrder.getTopOrders stays wired
// as the fallback for the books, batched: tRPC GET batching (?batch=1) is
// counted as ONE request by the rate limiter (verified: 499 -> 498 for a
// batch of three).

/** Batch URLs are kept under this length: a ~2,050-char URL died in the proxy chain (HANDOFF trpcPairs). */
export const BATCH_URL_BUDGET = 1400;

/**
 * Orders a side per code, so the quantity at the best level is the level's
 * depth, not one order's: the wooden case's top bid was a single unit at
 * launch, and the project's rule is to print depth, never just the top of book.
 */
export const BOOK_DEPTH = 20;
/** Every code's best orders: the multi-code procedure, BOOK_DEPTH a side. */
export const booksUrl = (codes) => withInput('tradingOrder.getTopOrdersPerItemCode', { itemCodes: codes, limit: BOOK_DEPTH });

/**
 * tRPC GET batch URLs for one procedure and many inputs, split by URL length:
 * [{ url, count }], positional results come back in the same order.
 */
export function batchUrls(proc, inputs) {
  const out = [];
  let slice = [];
  const urlFor = (s) => `${TRPC}${s.map(() => proc).join(',')}?batch=1&input=${encodeURIComponent(JSON.stringify(Object.fromEntries(s.map((i, k) => [k, i]))))}`;
  for (const input of inputs ?? []) {
    const next = [...slice, input];
    if (slice.length && urlFor(next).length > BATCH_URL_BUDGET) { out.push({ url: urlFor(slice), count: slice.length }); slice = [input]; }
    else slice = next;
  }
  if (slice.length) out.push({ url: urlFor(slice), count: slice.length });
  return out;
}

/** One keyed batched GET; resolves the positional array of `result.data` (null where a slot carried an error). */
async function callBatch(fetchImpl, key, proc, inputs, { timeoutMs = TIMEOUT_MS } = {}) {
  const data = [];
  let limit = null;
  let remaining = null;
  for (const b of batchUrls(proc, inputs)) {
    const r = await call(fetchImpl, key, b.url, { timeoutMs, batch: true });
    limit = r.limit;
    remaining = r.remaining;
    const arr = Array.isArray(r.data) ? r.data : [];
    for (let k = 0; k < b.count; k++) data.push(arr[k]?.result?.data ?? null);
  }
  return { data, limit, remaining };
}

const bestOf = (orders, better) => {
  const rows = (Array.isArray(orders) ? orders : []).filter((o) => Number.isFinite(Number(o?.price)));
  if (!rows.length) return { price: null, qty: 0 };
  const best = rows.reduce((p, o) => (better(Number(o.price), Number(p.price)) ? o : p), rows[0]);
  return { price: Number(best.price), qty: rows.filter((o) => Number(o.price) === Number(best.price)).reduce((s, o) => s + (Number(o.quantity) || 0), 0) };
};
const flattenBook = (d) => {
  const buy = bestOf(d?.buyOrders, (a, b) => a > b);
  const sell = bestOf(d?.sellOrders, (a, b) => a < b);
  return { bid: buy.price, ask: sell.price, bidQty: buy.qty, askQty: sell.qty };
};

/**
 * The best bid and ask of every code in `codes`: { books: { code: { bid, ask,
 * bidQty, askQty } }, source, limit, remaining }. One call to the multi-code
 * procedure; when that one is gone (an API error or a 4xx) the documented
 * getTopOrders is asked in batches instead.
 */
export async function fetchBooks(fetchImpl, key, codes, { timeoutMs = TIMEOUT_MS } = {}) {
  const k = cleanKey(key);
  const list = [...new Set((codes ?? []).map(String))];
  try {
    const { data, limit, remaining } = await call(fetchImpl, k, booksUrl(list), { timeoutMs });
    const books = {};
    for (const code of list) books[code] = flattenBook(data?.[code]);
    return { books, source: 'getTopOrdersPerItemCode', limit, remaining };
  } catch (e) {
    const gone = e instanceof ApiError && (e.code === 'api' || (e.code === 'http' && e.status >= 400 && e.status < 500));
    if (!gone) throw e;
  }
  const { data, limit, remaining } = await callBatch(fetchImpl, k, 'tradingOrder.getTopOrders', list.map((itemCode) => ({ itemCode, limit: BOOK_DEPTH })), { timeoutMs });
  const books = {};
  list.forEach((code, i) => { books[code] = flattenBook(data[i]); });
  return { books, source: 'getTopOrders', limit, remaining };
}

/**
 * The game's average item price ("Current value") per code, in batches:
 * { avg: { code: number | null }, missing, limit, remaining }. The game
 * itself prints `value || 0`, so a code with no sales comes back as 0: that
 * is no data, never a price, and is reported as missing.
 */
export async function fetchEquipmentAvg(fetchImpl, key, codes, { timeoutMs = TIMEOUT_MS } = {}) {
  const k = cleanKey(key);
  const list = [...new Set((codes ?? []).map(String))];
  const { data, limit, remaining } = await callBatch(fetchImpl, k, 'gameStat.getEquipmentAvgByCode', list.map((itemCode) => ({ itemCode })), { timeoutMs });
  const avg = {};
  const missing = [];
  list.forEach((code, i) => {
    const v = Number(data[i]);
    avg[code] = data[i] != null && Number.isFinite(v) && v > 0 ? v : null;
    if (avg[code] == null) missing.push(code);
  });
  return { avg, missing, limit, remaining };
}
