// The one API call the extension makes, and the rule that it is made only
// with the player's own key.
//
// Probed 2026-09-03: api2 does not refuse a wrong key. It answers the request
// from the keyless bucket (ratelimit-limit 100) as if no key were sent; an
// accepted key gets a bigger bucket (500). So whether the key was accepted is
// read off the ratelimit-limit header, and an answer from the keyless bucket
// is treated as a rejected key and its data discarded. Nothing here is ever
// read without an accepted key.
import { summarizeBook } from './scraplib.mjs';

export const BOOK_URL = 'https://api2.warera.io/trpc/tradingOrder.getTopOrders?input='
  + encodeURIComponent(JSON.stringify({ itemCode: 'scraps', limit: 100 }));
export const KEYLESS_LIMIT = 100;

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

/**
 * Read the scrap order book with `key`. Resolves { book, limit, remaining };
 * rejects with an ApiError whose `code` is one of
 * no-key | key-rejected | rate-limited | http | api.
 */
export async function fetchBook(fetchImpl, key) {
  const k = String(key ?? '').trim();
  if (!k) throw new ApiError('no API key set', 'no-key');
  const res = await fetchImpl(BOOK_URL, { headers: { 'x-api-key': k } });
  const limit = header(res, 'ratelimit-limit');
  const remaining = header(res, 'ratelimit-remaining');
  if (res.status === 429) throw new ApiError('rate limited by the API', 'rate-limited', { status: 429, retryAfter: header(res, 'ratelimit-reset') ?? 60 });
  if (!res.ok) throw new ApiError(`the API answered ${res.status}`, 'http', { status: res.status });
  if (limit != null && limit <= KEYLESS_LIMIT) {
    throw new ApiError('the API did not accept this key (it answered as if none were sent)', 'key-rejected', { status: res.status, limit });
  }
  const json = await res.json();
  if (json?.error) throw new ApiError(`API error: ${json.error.message || 'unknown'}`, 'api', { status: res.status });
  return { book: summarizeBook(json?.result?.data), limit, remaining };
}
