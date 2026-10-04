// @ts-check
// Resale evidence from one item's recent market fills: what comparable
// pieces actually sold for, how sure that figure is, and how an offer or a
// listing ranks against them. Pure; the toolbar and the Craft Desk render it.
//
// Two separate evidence bars, on purpose:
//   MIN_RESALE_SAMPLE (5)    comparable fills support the resale estimate
//                            (the median with its low–high range).
//   MIN_PERCENTILE_PEERS (8) valid peers are needed before a percentile rank
//                            or a quartile scenario (quick / patient) is shown.
// A rank over four or five prices says little more than the range does, while
// a median of five tells a player what a piece has been fetching. Keep the
// two thresholds apart: coupling them is the bug this module replaces.

export const MIN_RESALE_SAMPLE = 5;
export const MIN_PERCENTILE_PEERS = 8;
export const RESALE_WINDOW_HOURS = 72;
/** Durability points a comparable fill may differ by when the offer's own durability is known. */
export const STATE_TOLERANCE = 10;

/**
 * @typedef {{ price: number, at: string, state?: number | null, code?: string | null }} Fill
 * @typedef {{ code?: string | null, hours?: number, now?: number, state?: number | null, stateTolerance?: number }} ComparableOptions
 */

/** @param {unknown} v */
const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * The fills that count as comparable: a positive price, a readable time
 * inside the window, the requested item code, and (when the offer's own
 * durability is known) a durability within tolerance. A fill without a
 * readable durability is not a valid peer for a durability-aware comparison.
 * @param {ReadonlyArray<Fill> | null | undefined} fills
 * @param {ComparableOptions} [options]
 */
export function comparableFills(
  fills,
  {
    code = null,
    hours = RESALE_WINDOW_HOURS,
    now = Date.now(),
    state = null,
    stateTolerance = STATE_TOLERANCE,
  } = {},
) {
  const cutoff = now - hours * 3600e3;
  const out = [];
  for (const f of fills ?? []) {
    const price = finite(f?.price);
    const at = Date.parse(String(f?.at ?? ""));
    if (price == null || price <= 0 || !Number.isFinite(at)) continue;
    if (at < cutoff || at > now + 5000) continue;
    if (code != null && f.code !== code) continue;
    if (state != null) {
      const s = finite(f.state ?? null);
      if (s == null || Math.abs(s - state) > stateTolerance) continue;
    }
    out.push(f);
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/**
 * Linear-interpolated percentile of an ascending list (p in 0..100).
 * @param {ReadonlyArray<number>} sorted @param {number} p
 */
export function percentile(sorted, p) {
  const n = sorted.length;
  if (!n) return null;
  if (n === 1) return sorted[0];
  const pos = (Math.min(100, Math.max(0, p)) / 100) * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** @param {ReadonlyArray<number>} prices */
function median(prices) {
  return percentile(prices, 50);
}

/**
 * The resale estimate for comparable fills: the median once five support it,
 * quartiles once eight do, and the spread around the median as the stated
 * uncertainty. Never an estimate from fewer fills than the bar.
 * @param {ReadonlyArray<Fill> | null | undefined} fills  already comparable (see comparableFills) or raw
 * @param {ComparableOptions & { capped?: boolean, filter?: boolean }} [options]
 */
export function resaleEstimate(fills, options = {}) {
  const { capped = false, filter = true, now = Date.now() } = options;
  const list = filter
    ? comparableFills(fills, { ...options, now })
    : [...(fills ?? [])];
  const prices = list.map((f) => f.price).sort((a, b) => a - b);
  const n = prices.length;
  const base = {
    n,
    needed: MIN_RESALE_SAMPLE,
    peersNeeded: MIN_PERCENTILE_PEERS,
    windowHours: options.hours ?? RESALE_WINDOW_HOURS,
    capped,
    lastAt: list[0]?.at ?? null,
    spanHours: n ? (now - Date.parse(list[n - 1].at)) / 3600e3 : 0,
  };
  // "none" only when nothing was read at all; fills that exist but do not compare are "0 of 5".
  if (n === 0)
    return {
      ...base,
      status: (fills ?? []).length ? "insufficient" : "none",
      estimate: null,
      low: null,
      high: null,
      p25: null,
      p75: null,
      uncertaintyPct: null,
      quartiles: false,
    };
  if (n < MIN_RESALE_SAMPLE)
    return {
      ...base,
      status: "insufficient",
      estimate: null,
      low: prices[0],
      high: prices[n - 1],
      p25: null,
      p75: null,
      uncertaintyPct: null,
      quartiles: false,
    };
  const med = /** @type {number} */ (median(prices));
  const quartiles = n >= MIN_PERCENTILE_PEERS;
  const p25 = quartiles ? percentile(prices, 25) : null;
  const p75 = quartiles ? percentile(prices, 75) : null;
  // Median absolute deviation, as a share of the median: robust to one odd fill.
  const mad =
    median(prices.map((p) => Math.abs(p - med)).sort((a, b) => a - b)) ?? 0;
  return {
    ...base,
    status: "ok",
    estimate: med,
    low: prices[0],
    high: prices[n - 1],
    p25,
    p75,
    quartiles,
    uncertaintyPct: med > 0 ? (mad / med) * 100 : null,
  };
}

/**
 * Where `value` sits among `peers`, as a percentile (0 = below every peer,
 * 100 = above every peer; ties count half). Needs MIN_PERCENTILE_PEERS valid
 * peers; fewer is "insufficient", not a rank.
 * @param {unknown} value @param {ReadonlyArray<unknown> | null | undefined} peers
 */
export function percentileRank(value, peers) {
  const v = finite(value);
  /** @type {number[]} */
  const valid = [];
  for (const p of peers ?? []) {
    const x = finite(p);
    if (x != null && x > 0) valid.push(x);
  }
  const n = valid.length;
  const base = { n, needed: MIN_PERCENTILE_PEERS };
  if (v == null || n === 0)
    return { ...base, status: "none", percentile: null };
  if (n < MIN_PERCENTILE_PEERS)
    return { ...base, status: "insufficient", percentile: null };
  let below = 0;
  let equal = 0;
  for (const p of valid) {
    if (p < v) below++;
    else if (p === v) equal++;
  }
  return { ...base, status: "ok", percentile: ((below + equal / 2) / n) * 100 };
}

/**
 * Listing scenarios a seller can act on, each only where the evidence
 * supports it: balanced (the median) needs the resale estimate, quick and
 * patient (the quartiles) need the percentile bar. Prices are what the
 * market feed recorded for comparable fills; see proceeds() in craft.mjs for
 * what a seller nets of a listing.
 * @param {ReturnType<typeof resaleEstimate>} est
 */
export function listingScenarios(est) {
  /** @type {Record<string, { price: number, basis: string }>} */
  const out = {};
  if (est.status !== "ok" || est.estimate == null) return out;
  out.balanced = {
    price: est.estimate,
    basis: `median of ${est.n} comparable fills`,
  };
  if (est.quartiles && est.p25 != null && est.p75 != null) {
    out.quick = {
      price: est.p25,
      basis: `lower quartile of ${est.n} fills: priced under three quarters of them`,
    };
    out.patient = {
      price: est.p75,
      basis: `upper quartile of ${est.n} fills: a quarter sold higher`,
    };
  }
  return out;
}

/**
 * How briskly comparable pieces have been selling: fills per day over the
 * window and the median gap between consecutive fills. The gap is the
 * market's recent pace, not a promise about any one listing's queue.
 * @param {ReadonlyArray<Fill> | null | undefined} fills  comparable fills, any order
 * @param {{ now?: number, hours?: number }} [options]
 */
export function liquidity(
  fills,
  { now = Date.now(), hours = RESALE_WINDOW_HOURS } = {},
) {
  const times = (fills ?? [])
    .map((f) => Date.parse(String(f?.at ?? "")))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const n = times.length;
  if (n === 0)
    return { n, perDay: 0, medianGapHours: null, lastHour: 0, lastAt: null };
  const spanHours = Math.max(1, (now - times[0]) / 3600e3);
  const gaps = [];
  for (let i = 1; i < n; i++) gaps.push((times[i] - times[i - 1]) / 3600e3);
  gaps.sort((a, b) => a - b);
  return {
    n,
    perDay: (n / Math.min(spanHours, hours)) * 24,
    medianGapHours: gaps.length ? median(gaps) : null,
    lastHour: times.filter((t) => t >= now - 3600e3).length,
    lastAt: new Date(times[n - 1]).toISOString(),
  };
}
