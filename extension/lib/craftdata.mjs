// @ts-check
// The Craft Desk's adapter: where recipes, prices, outcome distributions and
// the tax rate come from, each labelled with its provenance, so the pure
// maths in craft.mjs never has to know. Three sources, in this order of
// trust: existing extension data (the scrap book, the resource books, the
// recent fills), the player's own inputs (manual), and fixtures (synthetic,
// for tests and screenshots). Nothing here invents a number: a missing input
// stays missing and is named.
import { RARITIES, WEAPONS, GEAR_CODES } from "./items.mjs";
import { freshness, TTL, nonNegative as money } from "./quality.mjs";
import { normalizeRecipe } from "./craft.mjs";
import { comparableFills, resaleEstimate } from "./resale.mjs";

/** @typedef {{ scraps: number, steel: number }} Recipe */
/** @typedef {{ value: number | null, source: "manual" | "page" | "quote" | "fixture" | "none", note?: string }} Sourced */

/** Crafted codes the desk works through: the six tiers of every slot. */
export const CRAFT_CODES = RARITIES.flatMap((r) => [
  GEAR_CODES[r].weapon,
  ...GEAR_CODES[r].gear,
]);

/** "boots5" -> { slot: "boots", tier: 5, rarity: "legendary" }; "jet" -> { slot: "weapon", tier: 6, rarity: "mythic" }. @param {unknown} code */
export function describeCode(code) {
  const c = String(code ?? "");
  const gear = /^(helmet|chest|gloves|pants|boots)([1-6])$/.exec(c);
  if (gear)
    return {
      code: c,
      slot: gear[1],
      tier: Number(gear[2]),
      rarity: RARITIES[Number(gear[2]) - 1],
    };
  const w = WEAPONS.indexOf(c);
  if (w >= 0)
    return { code: c, slot: "weapon", tier: w + 1, rarity: RARITIES[w] };
  return null;
}

/**
 * The recipe table the player keeps: a map code -> { scraps, steel }, read
 * from the game's craft screen by hand. Validated entry by entry; an
 * invalid entry is dropped, never repaired.
 * @param {unknown} raw
 * @returns {Record<string, Recipe>}
 */
export function normalizeRecipes(raw) {
  /** @type {Record<string, Recipe>} */
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [code, recipe] of Object.entries(
    /** @type {Record<string, unknown>} */ (raw),
  )) {
    if (!CRAFT_CODES.includes(code)) continue;
    const r = normalizeRecipe(recipe);
    if (r) out[code] = r;
  }
  return out;
}

/**
 * @typedef {{ bid?: number | null, ask?: number | null, bids?: Array<{price:number, quantity:number}> | null, asks?: Array<{price:number, quantity:number}> | null }} BookLike
 * @typedef {{ book?: { at?: string | null, bids?: Array<{price:number, quantity:number}>, asks?: Array<{price:number, quantity:number}>, bid?: number | null, ask?: number | null } | null, cases?: { at?: string | null, books?: Record<string, BookLike> } | null, salesByCode?: Record<string, { code: string, at: string, complete: boolean, fills: Array<{ price: number, at: string, state?: number | null, code?: string | null }> }> | null, settings?: { intervalSec?: number, craftRecipes?: unknown, taxPct?: unknown } | null }} LensState
 * @typedef {{ scrapPrice?: unknown, steelPrice?: unknown }} Manual
 */

/**
 * Both input prices, manual first, else the live best ask (what buying now
 * costs; the bid is kept for the placed-bid comparison), with freshness.
 * @param {LensState} state @param {Manual} [manual] @param {number} [now]
 */
export function inputPrices(state, manual = {}, now = Date.now()) {
  const scrapBook = state.book ?? null;
  const steelBook = state.cases?.books?.steel ?? null;
  const bookTtl = (state.settings?.intervalSec ?? 30) * 1000;
  /** @param {BookLike | null} book @param {string | null | undefined} at @param {number} ttl @param {unknown} override @param {string} name */
  const one = (book, at, ttl, override, name) => {
    const m = money(override);
    if (m != null)
      return {
        value: m,
        source: /** @type {const} */ ("manual"),
        fresh: true,
        note: `${name}: your price`,
      };
    const ask = money(book?.ask ?? book?.asks?.[0]?.price);
    if (ask == null)
      return {
        value: null,
        source: /** @type {const} */ ("none"),
        fresh: false,
        note: `${name}: no ask quote yet`,
      };
    const f = freshness(at ?? null, ttl, now);
    return {
      value: ask,
      source: /** @type {const} */ ("quote"),
      fresh: f === "fresh",
      note: `${name}: best ask ${f === "fresh" ? "(fresh)" : "(stale)"}`,
    };
  };
  return {
    scrap: {
      ...one(scrapBook, state.book?.at, bookTtl, manual.scrapPrice, "scraps"),
      book: scrapBook,
    },
    steel: {
      ...one(steelBook, state.cases?.at, TTL.cases, manual.steelPrice, "steel"),
      book: steelBook,
    },
  };
}

/**
 * The market tax rate: the player's own figure first, then what the page
 * notice printed, else zero with a note (the 1.4 convention: no adjustment).
 * @param {{ manual?: unknown, page?: unknown, settings?: unknown }} input
 */
export function taxRate({ manual = null, page = null, settings = null } = {}) {
  for (const [
    value,
    source,
  ] of /** @type {Array<[unknown, "manual" | "page"]>} */ ([
    [manual, "manual"],
    [settings, "manual"],
    [page, "page"],
  ])) {
    const n = money(value);
    if (n != null && n <= 100) return { value: n, source };
  }
  return {
    value: 0,
    source: /** @type {const} */ ("none"),
    note: "no rate read: proceeds equal the listing",
  };
}

/**
 * The outcome distribution for crafting `code`, from the evidence at hand:
 * with five comparable fills the result is one sales-weighted outcome,
 * "sells like recent fills", valued at their median, i.e. the roll
 * distribution is taken to be whatever the fills already reflect. A crafted
 * piece is new, so when the fills carry a durability only those within ten
 * points of 100% compare. Without the evidence there is no distribution and
 * the EV is unavailable; nothing is assumed.
 * @param {string} code
 * @param {{ salesByCode?: LensState["salesByCode"], now?: number }} [input]
 */
export function outcomesFor(
  code,
  { salesByCode = null, now = Date.now() } = {},
) {
  const sales = salesByCode?.[code];
  if (!sales)
    return {
      source: /** @type {const} */ ("none"),
      outcomes: [],
      estimate: null,
      fills: [],
      note: "no recent fills read for this item; select it on the market",
    };
  const anyState = sales.fills.some((f) => f?.state != null);
  const fills = comparableFills(sales.fills, {
    code,
    now,
    state: anyState ? 100 : null,
  });
  const est = resaleEstimate(fills, {
    filter: false,
    now,
    capped: !sales.complete,
    total: sales.fills.length,
  });
  const basis = anyState ? " at 90–100% durability" : "";
  if (est.status !== "ok")
    return {
      source: /** @type {const} */ ("none"),
      outcomes: [],
      estimate: est,
      fills,
      note: `${est.n} of ${est.needed} comparable fills${basis} in ${est.windowHours} h`,
    };
  return {
    source: /** @type {const} */ ("sales"),
    outcomes: [
      {
        label: `sells like the last ${est.n} fills`,
        p: 1,
        listing: est.estimate,
      },
    ],
    estimate: est,
    fills,
    note: `sales-weighted: assumes a crafted piece sells like recent fills${basis} (median of ${est.n})`,
  };
}
