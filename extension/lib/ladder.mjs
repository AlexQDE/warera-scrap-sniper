// @ts-check
// The scrap ladder, the dismantle yield and the craft fee. Provenance for
// every number: docs/GAME-FACTS.md §2 and §3.
//
// The ladder and the yield are measured, not guessed: the formula below
// reproduced 17,269,842 real dismantle transactions with zero mismatches
// (audit of the full WarEra market feed, August 2026). Edit only with
// evidence of that strength.
//
// Yield at durability `state` (0..maxState): the full ladder value at 100%,
// exactly one third at 0%, floored in between. Market listings are always at
// 100%, so the extension only ever uses the full value.

/** @typedef {"common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic"} Rarity */

/** Scraps a piece dismantles into at 100% durability, by rarity. @type {Readonly<Record<Rarity, number>>} */
export const SCRAP_LADDER = Object.freeze({
  common: 6,
  uncommon: 18,
  rare: 54,
  epic: 162,
  legendary: 486,
  mythic: 1458,
});

/**
 * Steel burned per craft when the game picks the slot, by the OUTPUT rarity
 * (the client bundle's `craftCostSteel`). The transaction feed never records
 * it and dismantling never returns it. @type {Readonly<Record<Rarity, number>>}
 */
export const CRAFT_STEEL = Object.freeze({
  common: 1,
  uncommon: 2,
  rare: 4,
  epic: 8,
  legendary: 16,
  mythic: 32,
});

/**
 * Picking the slot costs this many times the steel of a random craft; the
 * scraps stay the same. The craft menu says so, and the operator's in-game
 * readings of 2026-09-16 (378 / 436 g for a mythic) match the computed
 * 381 / 438 g.
 */
export const CHOSEN_SLOT_STEEL = 2;

/**
 * How a random craft picks its slot: a weapon about 30% of the time, each of
 * the five armour slots about 14% (2,200 crafts of five heavy crafters; the
 * game config's loot table also says 30% weapon). Sums to one.
 */
export const RANDOM_SLOT_ODDS = Object.freeze({
  weapon: 0.3,
  helmet: 0.14,
  chest: 0.14,
  gloves: 0.14,
  pants: 0.14,
  boots: 0.14,
});

/** @param {string} rarity */
const ladder = (rarity) =>
  Object.hasOwn(SCRAP_LADDER, rarity)
    ? SCRAP_LADDER[/** @type {Rarity} */ (rarity)]
    : null;

/**
 * The game's recipe for one craft of `rarity`: the tier's scrap value in
 * scraps (534,037 of 534,037 June 2026 craft rows carry exactly that as the
 * input) plus the steel fee, doubled when the slot is chosen. null for an
 * unknown rarity, never a guess.
 * @param {string} rarity @param {{ chosen?: boolean }} [options]
 * @returns {{ scraps: number, steel: number } | null}
 */
export function craftRecipe(rarity, { chosen = true } = {}) {
  const scraps = ladder(rarity);
  if (scraps == null) return null;
  const steel = CRAFT_STEEL[/** @type {Rarity} */ (rarity)];
  return { scraps, steel: chosen ? steel * CHOSEN_SLOT_STEEL : steel };
}

/**
 * Scraps returned by dismantling a piece of `rarity` at durability `state`
 * of `maxState`: the whole ladder at 100%, one third at 0%.
 * @param {string} rarity @param {unknown} state @param {unknown} [maxState]
 */
export function scrapYield(rarity, state, maxState = 100) {
  const full = ladder(rarity);
  if (full == null) return null;
  const max = Number(maxState) || 100;
  const s = Math.max(0, Math.min(max, Number(state) || 0));
  return Math.floor((full * (1 + (2 * s) / max)) / 3);
}
