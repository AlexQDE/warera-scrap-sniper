// @ts-check
import { normalizeRecipes } from "./craftdata.mjs";
/**
 * Where the drop policy starts selling: drops of this rarity and above are
 * valued at the game's average item price (sold on the equipment market),
 * every rarity below it at the scrap quote (dismantled). "never" scraps all.
 */
export const SELL_FROM = Object.freeze([
  "never",
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "mythic",
]);
export const DEFAULTS = Object.freeze({
  minMarginPct: 0,
  intervalSec: 30,
  collapsed: true,
  casesCollapsed: true,
  roundTrip: false,
  equipment: true,
  cases: true,
  travel: true,
  picker: true,
  sellFrom: "epic",
  craft: true,
  craftCollapsed: true,
  craftBatch: 1,
  craftTargetPct: 20,
  /** Market tax in percent; null means "not set": the page's notice is read, else no adjustment (the 1.4 convention). */
  taxPct: /** @type {number | null} */ (null),
  craftRecipes:
    /** @type {Record<string, { scraps: number, steel: number }>} */ ({}),
  schemaVersion: 3,
});
/** @param {unknown} value @param {number} min @param {number} max @param {number} fallback */
const clamp = (value, min, max, fallback) =>
  Number.isFinite(Number(value))
    ? Math.min(max, Math.max(min, Math.round(Number(value))))
    : fallback;
/** @param {unknown} value */
const taxRate = (value) => {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.round(Math.min(100, Math.max(0, n)) * 100) / 100
    : null;
};
/** Public preferences only. Never copy arbitrary storage fields across the content boundary.
 * @param {Record<string, unknown>} [input]
 */
export function preferences(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) input = {};
  return {
    ...DEFAULTS,
    minMarginPct: clamp(input.minMarginPct, -50, 500, 0),
    intervalSec: clamp(input.intervalSec, 10, 600, 30),
    collapsed:
      typeof input.collapsed === "boolean"
        ? input.collapsed
        : DEFAULTS.collapsed,
    casesCollapsed:
      typeof input.casesCollapsed === "boolean"
        ? input.casesCollapsed
        : DEFAULTS.casesCollapsed,
    roundTrip: input.roundTrip === true,
    equipment: input.equipment !== false,
    cases: input.cases !== false,
    travel: input.travel !== false,
    picker: input.picker !== false,
    sellFrom: SELL_FROM.includes(/** @type {string} */ (input.sellFrom))
      ? /** @type {string} */ (input.sellFrom)
      : DEFAULTS.sellFrom,
    craft: input.craft !== false,
    craftCollapsed:
      typeof input.craftCollapsed === "boolean"
        ? input.craftCollapsed
        : DEFAULTS.craftCollapsed,
    craftBatch: clamp(input.craftBatch, 1, 1000, DEFAULTS.craftBatch),
    craftTargetPct: clamp(
      input.craftTargetPct,
      -50,
      500,
      DEFAULTS.craftTargetPct,
    ),
    taxPct: taxRate(input.taxPct),
    craftRecipes: normalizeRecipes(input.craftRecipes),
  };
}
