// Scrap-value maths shared by the extension and the dashboard.
//
// Pure and import-light on purpose: the extension and the dashboard page load
// this file straight into the browser as an ES module, so the table on screen
// and the table in the tests are the same code. The ladder and the durability
// formula are imported from the audited source (measured on 17.3 million real
// dismantles - never re-derive them).
//
// The rule: scrap value = scraps x the scrap price, nothing else. The market
// shows gear prices as paid and the scrap price as paid, so no tax is added or
// removed on either leg.
import { SCRAP_LADDER, scrapYield } from './ladder.mjs';

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const times = (a, b) => (a == null || b == null ? null : a * b);

/**
 * One row per rarity for gear at `state`% durability (market listings are
 * always 100%), valued against the live scrap book: `valueAtAsk` prices the
 * scraps at the lowest sell order (THE scrap price - the floor a listing is
 * compared with), `valueAtBid` at the highest buy order, for reference.
 */
export function scrapTable({ bid, ask, state = 100 }) {
  const b = num(bid);
  const a = num(ask);
  return RARITIES.map((rarity) => {
    const y = scrapYield(rarity, state);
    return { rarity, full: SCRAP_LADDER[rarity], yield: y, valueAtAsk: times(y, a), valueAtBid: times(y, b) };
  });
}

const side = (orders, best) => {
  const rows = Array.isArray(orders) ? orders.filter((o) => Number.isFinite(Number(o?.price))) : [];
  if (!rows.length) return { price: null, qty: 0, at: null, orders: 0, depthQty: 0, capped: false };
  const price = rows.reduce((p, o) => (best(Number(o.price), p) ? Number(o.price) : p), Number(rows[0].price));
  const level = rows.filter((o) => Number(o.price) === price);
  const at = level.map((o) => o.offerAt).filter(Boolean).sort()[0] ?? null;
  return {
    price,
    qty: level.reduce((s, o) => s + (Number(o.quantity) || 0), 0),
    at,
    orders: rows.length,
    depthQty: rows.reduce((s, o) => s + (Number(o.quantity) || 0), 0),
    capped: rows.length >= 100,
  };
};

/**
 * Flatten a tradingOrder.getTopOrders answer into the numbers the page shows.
 * The API returns at most 100 rows per side; a side at 100 is truncated -
 * `capped` says so, and depth past that point is unknown, not zero.
 */
export function summarizeBook(book) {
  const buy = side(book?.buyOrders, (p, best) => p > best);
  const sell = side(book?.sellOrders, (p, best) => p < best);
  return {
    bid: buy.price, bidQty: buy.qty, bidAt: buy.at, bidOrders: buy.orders, bidDepthQty: buy.depthQty, bidCapped: buy.capped,
    ask: sell.price, askQty: sell.qty, askAt: sell.at, askOrders: sell.orders, askDepthQty: sell.depthQty, askCapped: sell.capped,
    spread: buy.price != null && sell.price != null ? sell.price - buy.price : null,
  };
}

/** Would buying this listing to scrap it pay? Price as shown, scraps x scrap price, nothing else. */
export function margin({ listedPrice, rarity, state = 100, scrapPrice }) {
  const cost = num(listedPrice);
  const y = scrapYield(rarity, state);
  const value = times(y, num(scrapPrice));
  const m = value == null || cost == null ? null : value - cost;
  return { cost, yield: y, value, margin: m, marginPct: m == null || !cost ? null : m / cost };
}
