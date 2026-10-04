// @ts-check
// Craft maths for the Craft Desk: what a craft costs, what its random
// outcomes are expected to net, and the most the inputs may cost before the
// expected result stops paying. Pure functions over explicit inputs; the
// adapter (craftdata.mjs) decides where recipes, prices and outcome
// distributions come from and labels their provenance.
//
// Money words, used consistently:
//   listing     the price a seller sets (the number shown on the market)
//   buyerPays   what the buyer hands over for that listing
//   sellerGets  what the seller nets of it after the market tax
//   cost        what the crafter paid for the inputs (scraps, steel)
// EV, profit and ROI are always in sellerGets minus cost. A fee is applied
// exactly once, on the sale leg; input prices are taken as paid.
import { positive, quote, nonNegative as money } from "./quality.mjs";

/** The market's smallest price step: every recorded price carries at most three decimals. */
export const TICK = 0.001;

/** @param {number} tick */
const decimalsOf = (tick) => {
  const s = String(tick);
  if (s.includes("e-")) return Number(s.split("e-")[1]);
  return s.split(".")[1]?.length ?? 0;
};

/**
 * Snap a price to the tick. "down" for the most a buyer may bid, "up" for
 * the least a seller must ask; a value already on a tick stays put even
 * when floating point puts it a hair off (0.3 / 0.001 is not an integer in
 * IEEE arithmetic).
 * @param {unknown} value @param {{ tick?: number, mode?: "down" | "up" | "nearest" }} [options]
 */
export function roundToTick(value, { tick = TICK, mode = "down" } = {}) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const v = Number(value);
  if (!Number.isFinite(v) || !(tick > 0)) return null;
  const steps = v / tick;
  const near = Math.round(steps);
  const k =
    Math.abs(steps - near) < 1e-7
      ? near
      : mode === "down"
        ? Math.floor(steps)
        : mode === "up"
          ? Math.ceil(steps)
          : near;
  return Number((k * tick).toFixed(decimalsOf(tick)));
}

/** @typedef {{ scraps: number, steel: number }} Recipe */

/**
 * A usable recipe: non-negative integer quantities, at least one of them
 * positive. Anything else is null, never a guessed recipe.
 * @param {unknown} recipe
 */
export function normalizeRecipe(recipe) {
  if (!recipe || typeof recipe !== "object") return null;
  const r = /** @type {Record<string, unknown>} */ (recipe);
  const scraps = Number(r.scraps ?? 0);
  const steel = Number(r.steel ?? 0);
  if (!Number.isSafeInteger(scraps) || !Number.isSafeInteger(steel))
    return null;
  if (scraps < 0 || steel < 0 || scraps + steel === 0) return null;
  return { scraps, steel };
}

/**
 * What a batch of crafts costs at given unit prices. An input the recipe
 * does not use needs no price; a used input without a price leaves the
 * total unknown.
 * @param {{ recipe: Recipe, batch?: number, scrapPrice?: unknown, steelPrice?: unknown }} input
 */
export function inputCost({ recipe, batch = 1, scrapPrice, steelPrice }) {
  const b = Number.isSafeInteger(batch) && batch > 0 ? batch : 1;
  const scraps = recipe.scraps * b;
  const steel = recipe.steel * b;
  const sp = money(scrapPrice);
  const stp = money(steelPrice);
  const scrapCost = scraps === 0 ? 0 : sp == null ? null : scraps * sp;
  const steelCost = steel === 0 ? 0 : stp == null ? null : steel * stp;
  const total =
    scrapCost == null || steelCost == null
      ? null
      : Math.round((scrapCost + steelCost) * 1e9) / 1e9;
  return {
    batch: b,
    scraps,
    steel,
    scrapCost,
    steelCost,
    total,
    perCraft: total == null ? null : total / b,
    missing: [
      ...(scrapCost == null ? ["scrap price"] : []),
      ...(steelCost == null ? ["steel price"] : []),
    ],
  };
}

/**
 * @typedef {{ bids?: ReadonlyArray<{price:number, quantity:number}> | null, asks?: ReadonlyArray<{price:number, quantity:number}> | null }} Book
 */

/**
 * One input bought two ways: at once, walking the asks for the whole
 * quantity (a price, when the observed depth covers it), or by placing a
 * bid at the best bid (cheaper, but a queue: it fills when a seller comes,
 * if one does). `front` is one tick above the best bid, ahead of the queue,
 * null when that would cross the spread (then taking the ask is the same).
 * @param {number} quantity @param {Book | null | undefined} book @param {number} [tick]
 */
export function buyWays(quantity, book, tick = TICK) {
  const asks = [...(book?.asks ?? [])];
  const bids = book?.bids ?? [];
  const take = quote(quantity, asks);
  const bestAsk = positive(asks[0]?.price);
  const bestBid = positive(bids[0]?.price);
  const front =
    bestBid == null
      ? null
      : bestAsk != null && bestBid + tick >= bestAsk
        ? null
        : roundToTick(bestBid + tick, { tick, mode: "nearest" });
  return {
    quantity,
    immediate: {
      total: take.value,
      average: take.average,
      complete: take.complete,
      filled: take.filled,
      bestAsk,
    },
    bid: {
      price: bestBid,
      total: bestBid == null ? null : bestBid * quantity,
      front,
      frontTotal: front == null ? null : front * quantity,
    },
  };
}

/**
 * Both inputs of a batch, each way. `immediate.total` is null unless every
 * used input can be filled from the observed asks; `bid.total` is null unless
 * every used input has a resting bid to join.
 * @param {{ recipe: Recipe, batch?: number, scrapBook?: Book | null, steelBook?: Book | null, tick?: number }} input
 */
export function acquisition({
  recipe,
  batch = 1,
  scrapBook = null,
  steelBook = null,
  tick = TICK,
}) {
  const b = Number.isSafeInteger(batch) && batch > 0 ? batch : 1;
  const parts = /** @type {Record<string, ReturnType<typeof buyWays>>} */ ({});
  if (recipe.scraps > 0)
    parts.scraps = buyWays(recipe.scraps * b, scrapBook, tick);
  if (recipe.steel > 0)
    parts.steel = buyWays(recipe.steel * b, steelBook, tick);
  const list = Object.values(parts);
  const sum = (
    /** @type {(p: ReturnType<typeof buyWays>) => number | null} */ pick,
  ) =>
    list.some((p) => pick(p) == null)
      ? null
      : list.reduce((s, p) => s + /** @type {number} */ (pick(p)), 0);
  return {
    batch: b,
    parts,
    immediate: {
      total: sum((p) => p.immediate.total),
      complete: list.every((p) => p.immediate.complete),
      missing: Object.keys(parts).filter((k) => !parts[k].immediate.complete),
    },
    bid: {
      total: sum((p) => p.bid.total),
      frontTotal: sum((p) => (p.bid.front == null ? null : p.bid.frontTotal)),
      missing: Object.keys(parts).filter((k) => parts[k].bid.price == null),
    },
  };
}

/**
 * What a listing turns into for both sides under the market tax. The game
 * prints a "taxed price": by default (`deducted`) that printed listing is
 * what the buyer pays and the tax comes out of the seller's proceeds; under
 * `added` the tax is put on top of the listing for the buyer and the seller
 * nets the listing. Either way the tax is counted once.
 * @param {{ listing: unknown, taxPct?: unknown, mode?: "deducted" | "added" }} input
 */
export function proceeds({ listing, taxPct = 0, mode = "deducted" }) {
  const l = money(listing);
  const t = Math.min(100, Math.max(0, Number(taxPct) || 0)) / 100;
  if (l == null)
    return {
      listing: null,
      buyerPays: null,
      sellerGets: null,
      tax: null,
      taxPct: t * 100,
      mode,
    };
  const tax = l * t;
  return mode === "added"
    ? {
        listing: l,
        buyerPays: l + tax,
        sellerGets: l,
        tax,
        taxPct: t * 100,
        mode,
      }
    : {
        listing: l,
        buyerPays: l,
        sellerGets: l - tax,
        tax,
        taxPct: t * 100,
        mode,
      };
}

/**
 * The listing that nets the seller at least `sellerGets`, on the tick.
 * @param {{ sellerGets: unknown, taxPct?: unknown, mode?: "deducted" | "added", tick?: number }} input
 */
export function listingForProceeds({
  sellerGets,
  taxPct = 0,
  mode = "deducted",
  tick = TICK,
}) {
  const target = money(sellerGets);
  const t = Math.min(100, Math.max(0, Number(taxPct) || 0)) / 100;
  if (target == null) return null;
  if (mode === "added") return roundToTick(target, { tick, mode: "up" });
  if (t >= 1) return null;
  return roundToTick(target / (1 - t), { tick, mode: "up" });
}

/**
 * @typedef {{ label: string, p: number, proceeds: number | null, source?: string }} Outcome
 */

/**
 * The expected value of one craft over its random outcomes. Probabilities
 * must be fractions summing to one; an outcome without a known value makes
 * the EV unavailable (with the covered share reported), it is never dropped
 * or imputed. A desirable roll is one outcome among the others, weighted by
 * its probability.
 * @param {{ outcomes: ReadonlyArray<Outcome> | null | undefined, cost?: unknown }} input
 */
export function craftEV({ outcomes, cost = null }) {
  const c = money(cost);
  const list = outcomes ?? [];
  const bad = list.find(
    (o) =>
      typeof o?.p !== "number" || !Number.isFinite(o.p) || o.p < 0 || o.p > 1,
  );
  const sum = list.reduce(
    (s, o) => s + (typeof o?.p === "number" ? o.p : 0),
    0,
  );
  if (!list.length || bad || Math.abs(sum - 1) > 1e-6)
    return {
      status: "invalid",
      reason: !list.length
        ? "no outcomes"
        : bad
          ? "a probability is not a fraction in 0..1"
          : `probabilities sum to ${(sum * 100).toFixed(2)}%, not 100%`,
      ev: null,
      profit: null,
      roi: null,
      pProfit: null,
      coverage: 0,
      missing: [],
      best: null,
      worst: null,
      cost: c,
    };
  const missing = list
    .filter((o) => money(o.proceeds) == null)
    .map((o) => o.label);
  const priced = list.filter((o) => money(o.proceeds) != null);
  const coverage = priced.reduce((s, o) => s + o.p, 0);
  if (missing.length)
    return {
      status: "unavailable",
      reason: `no value for ${missing.join(", ")}`,
      ev: null,
      profit: null,
      roi: null,
      pProfit: null,
      coverage,
      missing,
      best: null,
      worst: null,
      cost: c,
    };
  const ev = priced.reduce(
    (s, o) => s + o.p * /** @type {number} */ (money(o.proceeds)),
    0,
  );
  const values = priced.map((o) => /** @type {number} */ (money(o.proceeds)));
  const profit = c == null ? null : ev - c;
  return {
    status: "ok",
    reason: null,
    ev,
    profit,
    roi: profit == null || !(c != null && c > 0) ? null : profit / c,
    pProfit:
      c == null
        ? null
        : priced
            .filter((o) => /** @type {number} */ (money(o.proceeds)) > c)
            .reduce((s, o) => s + o.p, 0),
    coverage,
    missing,
    best: Math.max(...values),
    worst: Math.min(...values),
    cost: c,
  };
}

/**
 * The most an input may cost, on the tick, for the expected proceeds to
 * return the target ROI (0 for break-even) given the other input's price:
 *   cost budget = expected proceeds / (1 + target)
 *   max scrap price = (budget − steel × steel price) / scraps
 * and the same the other way round. null with the reason when the other
 * input alone eats the budget or the recipe does not use the input.
 * @param {{ recipe: Recipe, expectedProceeds: unknown, scrapPrice?: unknown, steelPrice?: unknown, targetMarginPct?: unknown, tick?: number }} input
 */
export function breakEven({
  recipe,
  expectedProceeds,
  scrapPrice = null,
  steelPrice = null,
  targetMarginPct = 0,
  tick = TICK,
}) {
  const e = money(expectedProceeds);
  const m = Math.max(-0.999999, (Number(targetMarginPct) || 0) / 100);
  const budget = e == null ? null : e / (1 + m);
  const sp = money(scrapPrice);
  const stp = money(steelPrice);
  /** @param {number} qty @param {number} otherQty @param {number | null} otherPrice @param {string} other */
  const solve = (qty, otherQty, otherPrice, other) => {
    if (budget == null)
      return { value: null, reason: "expected proceeds unknown" };
    if (qty === 0) return { value: null, reason: "the recipe uses none" };
    if (otherQty > 0 && otherPrice == null)
      return { value: null, reason: `${other} price unknown` };
    const left = budget - otherQty * (otherPrice ?? 0);
    if (left < 0)
      return {
        value: null,
        reason: `${other} alone costs more than the budget`,
      };
    return {
      value: roundToTick(left / qty, { tick, mode: "down" }),
      reason: null,
    };
  };
  return {
    targetMarginPct: m * 100,
    budget,
    maxScrapPrice: solve(recipe.scraps, recipe.steel, stp, "steel"),
    maxSteelPrice: solve(recipe.steel, recipe.scraps, sp, "scraps"),
  };
}

/**
 * One tier/slot worked through: the cost at the chosen unit prices, the
 * EV over the outcomes, batch totals and the two price ceilings.
 * @param {{ recipe: Recipe, batch?: number, scrapPrice?: unknown, steelPrice?: unknown, outcomes: ReadonlyArray<Outcome> | null | undefined, targetMarginPct?: unknown, tick?: number }} input
 */
export function craftPlan({
  recipe,
  batch = 1,
  scrapPrice,
  steelPrice,
  outcomes,
  targetMarginPct = 0,
  tick = TICK,
}) {
  const cost = inputCost({ recipe, batch, scrapPrice, steelPrice });
  const ev = craftEV({ outcomes, cost: cost.perCraft });
  const b = cost.batch;
  return {
    cost,
    ev,
    batch: {
      size: b,
      cost: cost.total,
      expectedProceeds: ev.ev == null ? null : ev.ev * b,
      expectedProfit: ev.profit == null ? null : ev.profit * b,
    },
    breakEven: breakEven({
      recipe,
      expectedProceeds: ev.ev,
      scrapPrice,
      steelPrice,
      targetMarginPct: 0,
      tick,
    }),
    target: breakEven({
      recipe,
      expectedProceeds: ev.ev,
      scrapPrice,
      steelPrice,
      targetMarginPct,
      tick,
    }),
  };
}

/**
 * Rank worked plans by ROI; plans without an EV sort last and keep their reason.
 * @template {{ plan: ReturnType<typeof craftPlan> }} T
 * @param {ReadonlyArray<T>} plans
 */
export function rankPlans(plans) {
  return [...plans].sort((a, b) => {
    const ra = a.plan.ev.roi;
    const rb = b.plan.ev.roi;
    if (ra == null && rb == null) return 0;
    if (ra == null) return 1;
    if (rb == null) return -1;
    return rb - ra;
  });
}
