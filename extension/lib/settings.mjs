// @ts-check
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
  schemaVersion: 2,
});
/** @param {unknown} value @param {number} min @param {number} max @param {number} fallback */
const clamp = (value, min, max, fallback) =>
  Number.isFinite(Number(value))
    ? Math.min(max, Math.max(min, Math.round(Number(value))))
    : fallback;
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
  };
}
