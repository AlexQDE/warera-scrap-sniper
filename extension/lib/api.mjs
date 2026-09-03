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

/** One keyed GET; resolves the tRPC `result.data` or throws a typed ApiError. */
async function call(fetchImpl, key, url) {
  const res = await fetchImpl(url, { headers: { 'x-api-key': key } });
  const limit = header(res, 'ratelimit-limit');
  const remaining = header(res, 'ratelimit-remaining');
  if (res.status === 429) throw new ApiError('rate limited by the API', 'rate-limited', { status: 429, retryAfter: header(res, 'ratelimit-reset') ?? 60 });
  if (!res.ok) throw new ApiError(`the API answered ${res.status}`, 'http', { status: res.status });
  if (limit != null && limit <= KEYLESS_LIMIT) {
    throw new ApiError('the API did not accept this key (it answered as if none were sent)', 'key-rejected', { status: res.status, limit });
  }
  const json = await res.json();
  if (json?.error) throw new ApiError(`API error: ${json.error.message || 'unknown'}`, 'api', { status: res.status });
  return { data: json?.result?.data, limit, remaining };
}

/**
 * Read the scrap order book with `key`. Resolves { book, limit, remaining };
 * rejects with an ApiError whose `code` is one of
 * no-key | key-rejected | rate-limited | http | api.
 */
export async function fetchBook(fetchImpl, key) {
  const k = cleanKey(key);
  const { data, limit, remaining } = await call(fetchImpl, k, BOOK_URL);
  return { book: summarizeBook(data), limit, remaining };
}

/**
 * Walk one item's market fills back `hours` (default 72), at most `maxPages`
 * pages of 100. Resolves { fills: [{ price, at, state, code }], pages,
 * complete } where `complete` says the window was covered (or the feed ended)
 * rather than the page cap being hit.
 */
export async function fetchSales(fetchImpl, key, itemCode, { hours = 72, maxPages = 5, now = Date.now() } = {}) {
  const k = cleanKey(key);
  const cutoff = now - hours * 3600e3;
  const fills = [];
  let cursor;
  let pages = 0;
  let complete = false;
  while (pages < maxPages) {
    const { data } = await call(fetchImpl, k, salesUrl(itemCode, cursor));
    pages++;
    const items = Array.isArray(data?.items) ? data.items : [];
    for (const it of items) {
      if (!(Date.parse(it.createdAt) >= cutoff)) { complete = true; break; }
      fills.push({ price: Number(it.money), at: it.createdAt, state: it.item?.state ?? null, code: it.item?.code ?? it.itemCode });
    }
    if (complete) break;
    if (!data?.nextCursor || items.length === 0) { complete = true; break; }
    cursor = data.nextCursor;
  }
  return { fills, pages, complete };
}
