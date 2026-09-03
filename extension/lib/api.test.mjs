import { describe, it, expect } from 'vitest';
import { BOOK_URL, KEYLESS_LIMIT, ApiError, fetchBook } from './api.mjs';

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
