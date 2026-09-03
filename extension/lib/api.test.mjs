import { describe, it, expect } from 'vitest';
import { BOOK_URL, KEYLESS_LIMIT, ApiError, fetchBook, fetchSales, salesUrl } from './api.mjs';

// The API, probed 2026-09-03: a request with a WRONG key is not refused, it is
// answered from the keyless bucket (ratelimit-limit 100); an accepted key gets
// a bigger bucket (500). So "was the key accepted" is read off that header.
const order = (type, price, quantity) => ({ _id: 'x', user: 'u', itemCode: 'scraps', quantity, price, offerAt: '2026-09-03T10:00:00.000Z', type, __v: 0 });
const BODY = { result: { data: { buyOrders: [order('buy', 0.225, 100)], sellOrders: [order('sell', 0.226, 50)] } } };

const fake = ({ status = 200, limit = 500, remaining = 499, reset = 60, body = BODY } = {}) => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'ratelimit-limit': String(limit), 'ratelimit-remaining': String(remaining), 'ratelimit-reset': String(reset) }),
      json: async () => body,
    };
  };
  return { fetchImpl, calls };
};

describe('fetchBook', () => {
  it('sends the key as x-api-key and returns the summarised book with its rate bucket', async () => {
    const { fetchImpl, calls } = fake();
    const r = await fetchBook(fetchImpl, 'my-key');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(BOOK_URL);
    expect(calls[0].opts.headers['x-api-key']).toBe('my-key');
    expect(r.book.bid).toBe(0.225);
    expect(r.book.ask).toBe(0.226);
    expect(r.limit).toBe(500);
    expect(r.remaining).toBe(499);
  });

  it('refuses to call the API without a key', async () => {
    const { fetchImpl, calls } = fake();
    await expect(fetchBook(fetchImpl, '')).rejects.toMatchObject({ code: 'no-key' });
    await expect(fetchBook(fetchImpl, '   ')).rejects.toMatchObject({ code: 'no-key' });
    expect(calls).toHaveLength(0);
  });

  it('treats an answer from the keyless bucket as a rejected key and discards the data', async () => {
    const { fetchImpl } = fake({ limit: KEYLESS_LIMIT, remaining: 99 });
    const err = await fetchBook(fetchImpl, 'wrong-key').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('key-rejected');
    expect(err.book).toBeUndefined();
  });

  it('reports a rate limit with the seconds until reset', async () => {
    const { fetchImpl } = fake({ status: 429, reset: 37, body: {} });
    await expect(fetchBook(fetchImpl, 'k')).rejects.toMatchObject({ code: 'rate-limited', retryAfter: 37, status: 429 });
  });

  it('surfaces an error envelope from the API', async () => {
    const { fetchImpl } = fake({ body: { error: { message: 'boom' } } });
    const err = await fetchBook(fetchImpl, 'k').catch((e) => e);
    expect(err.code).toBe('api');
    expect(err.message).toContain('boom');
  });

  it('surfaces other HTTP failures with their status', async () => {
    const { fetchImpl } = fake({ status: 503, body: {} });
    await expect(fetchBook(fetchImpl, 'k')).rejects.toMatchObject({ code: 'http', status: 503 });
  });
});

// transaction.getPaginatedTransactions with itemCode (documented in openapi.json)
// and no userId is the global feed of one item's market fills, newest first,
// 100 per page with a cursor. Probed 2026-09-03: 100 jet fills spanned ~30 h.
const NOW = Date.parse('2026-09-03T20:00:00.000Z');
const fill = (hoursAgo, money, code = 'jet') => ({
  _id: 'x', money, itemCode: code, quantity: 1, transactionType: 'itemMarket',
  item: { code, state: 100, skills: {} }, createdAt: new Date(NOW - hoursAgo * 3600e3).toISOString(),
});
const pagedFake = (pages, { limit = 500 } = {}) => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    const cursor = new URL(url).searchParams.get('input');
    const idx = Math.min(calls.length - 1, pages.length - 1);
    const page = pages[idx];
    return {
      ok: true, status: 200,
      headers: new Headers({ 'ratelimit-limit': String(limit), 'ratelimit-remaining': '400', 'ratelimit-reset': '60' }),
      json: async () => ({ result: { data: { items: page.items, nextCursor: page.next ?? null } } }),
      _cursorInput: cursor,
    };
  };
  return { fetchImpl, calls };
};

describe('fetchSales', () => {
  it('asks for the item code with the key and stops once the window is covered', async () => {
    const { fetchImpl, calls } = pagedFake([
      { items: [fill(1, 383.8), fill(20, 390), fill(60, 379.2)], next: 'c2' },
      { items: [fill(71, 401), fill(80, 350), fill(90, 340)], next: 'c3' },
    ]);
    const r = await fetchSales(fetchImpl, 'my-key', 'jet', { hours: 72, now: NOW, maxPages: 5 });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(salesUrl('jet'));
    expect(calls[0].opts.headers['x-api-key']).toBe('my-key');
    expect(calls[1].url).toBe(salesUrl('jet', 'c2'));
    expect(r.fills.map((f) => f.price)).toEqual([383.8, 390, 379.2, 401]);
    expect(r.fills[0]).toMatchObject({ price: 383.8, state: 100, code: 'jet' });
    expect(r.pages).toBe(2);
    expect(r.complete).toBe(true);
  });

  it('stops at the last page even when the window is not yet covered', async () => {
    const { fetchImpl, calls } = pagedFake([{ items: [fill(1, 100), fill(2, 101)], next: null }]);
    const r = await fetchSales(fetchImpl, 'k', 'knife', { hours: 72, now: NOW });
    expect(calls).toHaveLength(1);
    expect(r.fills).toHaveLength(2);
    expect(r.complete).toBe(true);
  });

  it('caps the pages it will walk and says the window is incomplete', async () => {
    const page = { items: Array.from({ length: 100 }, (_, i) => fill(i / 100, 10)), next: 'more' };
    const { fetchImpl, calls } = pagedFake([page, page, page, page]);
    const r = await fetchSales(fetchImpl, 'k', 'gloves4', { hours: 72, now: NOW, maxPages: 2 });
    expect(calls).toHaveLength(2);
    expect(r.fills).toHaveLength(200);
    expect(r.pages).toBe(2);
    expect(r.complete).toBe(false);
  });

  it('refuses without a key and rejects a keyless-bucket answer', async () => {
    const { fetchImpl, calls } = pagedFake([{ items: [fill(1, 1)], next: null }]);
    await expect(fetchSales(fetchImpl, '', 'jet', { now: NOW })).rejects.toMatchObject({ code: 'no-key' });
    expect(calls).toHaveLength(0);
    const keyless = pagedFake([{ items: [fill(1, 1)], next: null }], { limit: KEYLESS_LIMIT });
    await expect(fetchSales(keyless.fetchImpl, 'wrong', 'jet', { now: NOW })).rejects.toMatchObject({ code: 'key-rejected' });
  });
});
