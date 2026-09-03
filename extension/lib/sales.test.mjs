import { describe, it, expect } from 'vitest';
import { salesStats } from './sales.mjs';

// Fills as fetchSales returns them: price (gold as paid), at (ISO), state.
const NOW = Date.parse('2026-09-03T20:00:00.000Z');
const h = (hoursAgo) => new Date(NOW - hoursAgo * 3600e3).toISOString();
const fills = [
  { price: 383.8, at: h(0.5), state: 100 },
  { price: 379.208, at: h(0.2), state: 100 },
  { price: 392.991, at: h(5), state: 100 },
  { price: 370, at: h(30), state: 100 },
  { price: 401, at: h(70), state: 100 },
  { price: 350, at: h(80), state: 100 },   // outside 72 h
];

describe('salesStats', () => {
  it('counts, floors and medians the fills inside the window, newest first', () => {
    const s = salesStats(fills, { hours: 72, now: NOW, floor: 329.508 });
    expect(s.count).toBe(5);
    expect(s.low).toBe(370);
    expect(s.high).toBe(401);
    expect(s.median).toBeCloseTo(383.8, 9);       // 370, 379.208, [383.8], 392.991, 401
    expect(s.last).toEqual({ price: 379.208, at: h(0.2), state: 100 });
    expect(s.lastHour).toBe(2);
    expect(s.underFloor).toBe(0);
    expect(s.recent.map((f) => f.price)).toEqual([379.208, 383.8, 392.991, 370, 401]);
    expect(s.spanHours).toBeCloseTo(70, 9);
  });

  it('averages the two middle prices for an even count and counts fills under the floor', () => {
    const four = fills.slice(0, 4);
    const s = salesStats(four, { hours: 72, now: NOW, floor: 380 });
    expect(s.count).toBe(4);
    expect(s.median).toBeCloseTo((379.208 + 383.8) / 2, 9);
    expect(s.underFloor).toBe(2);                 // 379.208 and 370
  });

  it('is empty, not broken, without fills', () => {
    const s = salesStats([], { hours: 72, now: NOW, floor: 10 });
    expect(s.count).toBe(0);
    expect(s.spanHours).toBe(0);
    expect(s.low).toBeNull();
    expect(s.median).toBeNull();
    expect(s.last).toBeNull();
    expect(s.lastHour).toBe(0);
    expect(s.underFloor).toBe(0);
    expect(s.recent).toEqual([]);
  });

  it('keeps at most ten recent fills for display', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ price: 100 + i, at: h(i / 10), state: 100 }));
    expect(salesStats(many, { hours: 72, now: NOW, floor: null }).recent).toHaveLength(10);
  });
});
