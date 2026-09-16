import { describe, it, expect } from 'vitest';
import { casesStripHtml, tripLineHtml, verdictTag, ago } from './casesui.mjs';
import { GEAR_CODES } from './cases.mjs';

const BIDS = {
  cookedFish: 7.981, heavyAmmo: 2.673, cocain: 36.702, ammo: 0.685, steak: 3.795,
  concrete: 2.002, steel: 1.794, bread: 1.945, oil: 0.241, paper: 0.197, lightAmmo: 0.181,
  grain: 0.082, iron: 0.091, wood: 0.09, lead: 0.085, limestone: 0.105, coca: 0.082, petroleum: 0.117, livestock: 1.531, fish: 3.37,
  scraps: 0.222, case1: 3.439, case2: 21.701, woodenCase: 7.55,
};
const books = Object.fromEntries(Object.entries(BIDS).map(([code, bid]) => [code, { bid, ask: +(bid * 1.01).toFixed(3), bidQty: 20068, askQty: 50 }]));
const NOW = Date.parse('2026-09-16T10:00:00.000Z');
const cases = { at: '2026-09-16T09:59:48.000Z', books, source: 'getTopOrdersPerItemCode', avg: null, avgAt: null, avgError: null, limit: 500, remaining: 497 };

describe('casesStripHtml', () => {
  it('shows the three cases with bid, open value and the verdict, and names the rule', () => {
    const html = casesStripHtml({ cases, now: NOW });
    expect(html).toContain('Wooden Case');
    expect(html).toContain('Elite Case');
    expect(html).toContain('7.550');            // sealed bid
    expect(html).toContain('6.118');            // opens for
    expect(html).toContain('1.23×');
    expect(html).toContain('data-verdict="sell"');
    expect(html).toContain('data-verdict="even"');   // case1 at 1.05x
    expect(html).toContain('20k wanted');
    expect(html).toContain('prices 12s ago');
    expect(html).toContain('opens valued at the scrap floor');
    expect(html).toContain('497 of 500');
  });

  it('uses the average item prices when they were read, and dates them', () => {
    const avg = Object.fromEntries(Object.values(GEAR_CODES).flatMap((g) => [g.weapon, ...g.gear]).map((c) => [c, 10]));
    const html = casesStripHtml({ cases: { ...cases, avg, avgAt: '2026-09-16T09:55:00.000Z' }, now: NOW });
    expect(html).toContain('avg items 10.000');
    expect(html).toContain('read 5m ago');
    expect(html).toContain('data-verdict="open"');   // case1: 3.44 bid vs 10 at avg prices
  });

  it('shows the setup notice instead of rows, and a failed read with the old numbers', () => {
    expect(casesStripHtml({ cases: null, notice: '<b>Add your key</b>' })).toContain('Add your key');
    expect(casesStripHtml({ cases: null, notice: '<b>Add your key</b>' })).not.toContain('ss-c-row');
    const html = casesStripHtml({ cases, error: 'the API answered 503', now: NOW });
    expect(html).toContain('read failed · showing 12s ago');
    expect(html).toContain('7.550');
    expect(casesStripHtml({ cases: null, now: NOW })).toContain('reading the case prices');
  });
});

describe('tripLineHtml', () => {
  it('prices the walk both ways and nets the case, sealed and opened', () => {
    const { html, title } = tripLineHtml({ hops: 7, oilAsk: 0.242, sealedBid: 7.55, openValue: 6.12 });
    expect(html).toContain('<b>7</b> regions');
    expect(html).toContain('<b>70</b> stamina');
    expect(html).toContain('14 oil = 3.39 g');
    expect(html).toContain('+4.16');
    expect(html).toContain('+2.73');
    expect(html).toContain('free on a full bar');
    expect(title).toContain('Round trip: sealed +0.77, opened −0.66');
    expect(title).toContain('up to 15 regions sold sealed, 12 opened');
  });

  it('calls a far trip a loss on oil and says so', () => {
    const { html } = tripLineHtml({ hops: 19, oilAsk: 0.242, sealedBid: 7.55, openValue: 6.12 });
    expect(html).toContain('38 oil');
    expect(html).toContain('ss-bad');
    expect(html).toContain('oil loses gold');
    expect(html).toContain('<b>190</b> stamina');
  });

  it('draws nothing without a distance', () => {
    expect(tripLineHtml({ hops: null, oilAsk: 0.242, sealedBid: 7.55, openValue: 6.12 }).html).toBe('');
  });
});

describe('verdictTag / ago', () => {
  it('names each verdict', () => {
    expect(verdictTag('sell').text).toBe('SELL');
    expect(verdictTag('open').text).toBe('OPEN');
    expect(verdictTag('even').text).toBe('EVEN');
    expect(verdictTag(null, null).why).toBe('no price yet');
  });
  it('formats ages', () => {
    expect(ago('2026-09-16T09:59:48.000Z', NOW)).toBe('12s ago');
    expect(ago('2026-09-16T08:00:00.000Z', NOW)).toBe('2h ago');
    expect(ago(null)).toBe('never');
  });
});
