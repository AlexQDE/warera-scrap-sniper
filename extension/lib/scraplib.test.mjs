import { describe, it, expect } from 'vitest';
import { RARITIES, scrapTable, summarizeBook, margin } from './scraplib.mjs';

const near = (a, b) => expect(a).toBeCloseTo(b, 6);

// Editor's rule (2026-09-03): scrap value = scraps x the scrap price, nothing
// else. No tax on either leg - the market shows gear prices as paid, and the
// scrap price shown is the scrap price paid.
describe('scrapTable', () => {
  it('lists the six rarities in ladder order with pristine yields', () => {
    const rows = scrapTable({ bid: 0.225, ask: 0.226, state: 100 });
    expect(rows.map((r) => r.rarity)).toEqual(RARITIES);
    expect(rows.map((r) => r.yield)).toEqual([6, 18, 54, 162, 486, 1458]);
  });

  it('yields exactly one third at zero durability', () => {
    const rows = scrapTable({ bid: 0.225, ask: 0.226, state: 0 });
    expect(rows.map((r) => r.yield)).toEqual([2, 6, 18, 54, 162, 486]);
  });

  it('floors a mid-durability yield', () => {
    const rows = scrapTable({ bid: 0.225, ask: 0.226, state: 50 });
    expect(rows[0].yield).toBe(4);      // floor(6 * 2/3)
    expect(rows[5].yield).toBe(972);    // floor(1458 * 2/3)
  });

  it('values the scraps at the ask and at the bid, plain multiplication', () => {
    const [, , , , , mythic] = scrapTable({ bid: 0.225, ask: 0.226 });
    near(mythic.valueAtAsk, 1458 * 0.226);
    near(mythic.valueAtBid, 1458 * 0.225);
    expect(Object.keys(mythic).sort()).toEqual(['full', 'rarity', 'valueAtAsk', 'valueAtBid', 'yield']);
  });

  it('returns null money columns when a side of the book is empty', () => {
    const [common] = scrapTable({ bid: null, ask: 0.226 });
    expect(common.yield).toBe(6);
    near(common.valueAtAsk, 6 * 0.226);
    expect(common.valueAtBid).toBeNull();
  });
});

// Verbatim row shape from tradingOrder.getTopOrders({ itemCode: 'scraps' }), 2026-09-03.
const order = (type, price, quantity, offerAt) => ({
  _id: 'x', user: 'u', itemCode: 'scraps', quantity, price, offerAt, type, __v: 0,
});
const book = {
  buyOrders: [
    order('buy', 0.225, 12960, '2026-09-03T10:53:23.089Z'),
    order('buy', 0.225, 500, '2026-09-03T09:00:00.000Z'),
    order('buy', 0.224, 1000, '2026-09-02T10:00:00.000Z'),
  ],
  sellOrders: [
    order('sell', 0.226, 270, '2026-09-03T15:16:46.768Z'),
    order('sell', 0.227, 900, '2026-09-03T12:00:00.000Z'),
  ],
};

describe('summarizeBook', () => {
  it('reads best bid and ask with the quantity resting at that level', () => {
    const s = summarizeBook(book);
    expect(s.bid).toBe(0.225);
    expect(s.ask).toBe(0.226);
    near(s.spread, 0.001);
    expect(s.bidQty).toBe(13460);
    expect(s.askQty).toBe(270);
  });

  it('dates a level by its oldest resting order', () => {
    const s = summarizeBook(book);
    expect(s.bidAt).toBe('2026-09-03T09:00:00.000Z');
    expect(s.askAt).toBe('2026-09-03T15:16:46.768Z');
  });

  it('counts orders and total depth per side and flags a side at the 100-row cap', () => {
    const s = summarizeBook(book);
    expect(s.bidOrders).toBe(3);
    expect(s.askOrders).toBe(2);
    expect(s.bidDepthQty).toBe(14460);
    expect(s.askDepthQty).toBe(1170);
    expect(s.bidCapped).toBe(false);
    const full = { buyOrders: Array.from({ length: 100 }, () => order('buy', 0.2, 1, '2026-09-03T00:00:00.000Z')), sellOrders: [] };
    expect(summarizeBook(full).bidCapped).toBe(true);
  });

  it('returns nulls for an empty side', () => {
    const s = summarizeBook({ buyOrders: [], sellOrders: book.sellOrders });
    expect(s.bid).toBeNull();
    expect(s.bidQty).toBe(0);
    expect(s.bidAt).toBeNull();
    expect(s.spread).toBeNull();
    expect(s.ask).toBe(0.226);
  });
});

describe('margin', () => {
  it('is the scrap value at the scrap price minus the price as shown, no tax anywhere', () => {
    const m = margin({ listedPrice: 300, rarity: 'mythic', scrapPrice: 0.226 });
    near(m.cost, 300);
    expect(m.yield).toBe(1458);
    near(m.value, 1458 * 0.226);
    near(m.margin, 1458 * 0.226 - 300);
    near(m.marginPct, (1458 * 0.226 - 300) / 300);
  });

  it('shows a loss for a worn item priced at the pristine value', () => {
    const m = margin({ listedPrice: 320, rarity: 'mythic', state: 0, scrapPrice: 0.226 });
    expect(m.yield).toBe(486);
    expect(m.margin).toBeLessThan(0);
  });

  it('returns null when there is no scrap price', () => {
    const m = margin({ listedPrice: 10, rarity: 'rare', scrapPrice: null });
    expect(m.value).toBeNull();
    expect(m.margin).toBeNull();
  });
});
