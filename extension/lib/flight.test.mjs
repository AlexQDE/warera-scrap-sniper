import { describe, it, expect } from 'vitest';
import { makeSingleFlight } from './flight.mjs';

// Concurrent asks for the same thing (two tabs ticking, tick + refresh button)
// must share one read instead of each hitting the API.
describe('single flight', () => {
  it('lets concurrent callers share one run and runs again once it settled', async () => {
    const once = makeSingleFlight();
    let runs = 0;
    let release;
    const run = () => new Promise((r) => { runs++; release = r; });
    const a = once('book', run);
    const b = once('book', run);
    expect(runs).toBe(1);
    release('fresh');
    expect(await a).toBe('fresh');
    expect(await b).toBe('fresh');
    expect(await once('book', async () => { runs++; return 'again'; })).toBe('again');
    expect(runs).toBe(2);
  });

  it('keeps different keys apart', async () => {
    const once = makeSingleFlight();
    const a = once('sales:jet', async () => 'jet');
    const b = once('sales:gun', async () => 'gun');
    expect(await a).toBe('jet');
    expect(await b).toBe('gun');
  });

  it('hands a failure to every waiter and frees the key', async () => {
    const once = makeSingleFlight();
    const boom = () => Promise.reject(new Error('boom'));
    const a = once('book', boom);
    const b = once('book', boom);
    await expect(a).rejects.toThrow('boom');
    await expect(b).rejects.toThrow('boom');
    expect(await once('book', async () => 'ok')).toBe('ok');
  });
});
