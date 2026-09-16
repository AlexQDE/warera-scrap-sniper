// @ts-check
export const TTL = Object.freeze({
  book: 30_000,
  cases: 60_000,
  sales: 180_000,
  avg: 600_000,
});
export const CACHE_VERSION = 2;

/** @param {unknown} value */
export function positive(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** @param {string | null | undefined} at @param {number} ttl @param {number} [now] */
export function freshness(at, ttl, now = Date.now()) {
  const age = at ? now - Date.parse(at) : NaN;
  return !Number.isFinite(age) || age < -5000
    ? "missing"
    : age < ttl
      ? "fresh"
      : "stale";
}

/** @typedef {{price:number, quantity:number}} Level */
/** Walk a snapshot, never assume liquidity past the observed book.
 * @param {number} quantity @param {Level[] | null | undefined} levels
 */
export function quote(quantity, levels) {
  if (!Number.isInteger(quantity) || quantity < 0)
    return { value: null, filled: 0, complete: false, average: null };
  let remaining = quantity;
  let value = 0;
  for (const level of levels ?? []) {
    if (
      positive(level.price) == null ||
      !Number.isInteger(level.quantity) ||
      level.quantity < 1
    )
      continue;
    const take = Math.min(remaining, level.quantity);
    value += take * level.price;
    remaining -= take;
    if (!remaining) break;
  }
  value = Math.round(value * 1e9) / 1e9;
  return {
    value: remaining ? null : value,
    filled: quantity - remaining,
    complete: remaining === 0,
    average: quantity && !remaining ? value / quantity : null,
  };
}
