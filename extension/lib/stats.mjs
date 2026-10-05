// @ts-check
// What each item rolls and the range it rolls in, from the game config's
// `items[].dynamicStats` (docs/GAME-FACTS.md §4; the codex prints the same
// tables, with a 260-profile live check). The holes between tiers are the
// game's own, so a stat value maps back to its tier unambiguously. The shape
// of the roll inside a range is not known: nothing here weights it.
import { RARITIES, WEAPONS, SLOTS } from "./items.mjs";

/** @typedef {readonly [number, number]} Range */

/** @type {ReadonlyArray<Range>} */
const WEAPON_ATTACK = [
  [21, 40],
  [51, 60],
  [71, 90],
  [101, 130],
  [141, 170],
  [221, 300],
];
/** @type {ReadonlyArray<Range>} */
const WEAPON_CRIT = [
  [1, 5],
  [6, 10],
  [11, 15],
  [16, 20],
  [26, 35],
  [41, 50],
];
/** @type {ReadonlyArray<Range>} */
const HELMET = [
  [1, 15],
  [16, 30],
  [31, 50],
  [71, 90],
  [91, 110],
  [121, 150],
];
/** @type {ReadonlyArray<Range>} */
const ARMOR = [
  [1, 5],
  [6, 10],
  [11, 15],
  [21, 30],
  [36, 50],
  [56, 70],
];
/** @type {ReadonlyArray<Range>} */
const SMALL = [
  [1, 5],
  [6, 10],
  [11, 15],
  [21, 25],
  [31, 40],
  [51, 60],
];
/** @type {Readonly<Record<string, string>>} */
const SLOT_STAT = {
  helmet: "criticalDamages",
  chest: "armor",
  pants: "armor",
  gloves: "precision",
  boots: "dodge",
};
/** @type {Readonly<Record<string, ReadonlyArray<Range>>>} */
const SLOT_TABLE = {
  helmet: HELMET,
  chest: ARMOR,
  pants: ARMOR,
  gloves: SMALL,
  boots: SMALL,
};

/** Stat ranges per code: `jet` → { attack: [221, 300], criticalChance: [41, 50] }, `boots5` → { dodge: [31, 40] }.
 * @type {Readonly<Record<string, Readonly<Record<string, Range>>>>} */
export const STAT_RANGES = Object.freeze(
  Object.fromEntries([
    ...WEAPONS.map((w, i) => [
      w,
      { attack: WEAPON_ATTACK[i], criticalChance: WEAPON_CRIT[i] },
    ]),
    ...SLOTS.flatMap((slot) =>
      RARITIES.map((_, i) => [
        `${slot}${i + 1}`,
        { [SLOT_STAT[slot]]: SLOT_TABLE[slot][i] },
      ]),
    ),
  ]),
);

/**
 * The stat that prices a piece: the one stat of an armour slot, and critical
 * chance for a weapon (its value steps at 50 where attack does not; the ledger
 * site groups weapon rolls by it too). null for a code that rolls nothing.
 * @param {string} code
 */
export function keyStat(code) {
  const r = STAT_RANGES[code];
  if (!r) return null;
  return WEAPONS.includes(code) ? "criticalChance" : Object.keys(r)[0];
}

/**
 * The fifth of its range a roll falls in, the grouping the ledger site shows
 * (26–27 for a tank's crit, 91–94 for a legendary helmet). Every range is a
 * multiple of five wide, so the bands are whole numbers. null outside the
 * range or for an unknown code or stat.
 * @param {string} code @param {string} stat @param {unknown} value
 * @returns {{ lo: number, hi: number } | null}
 */
export function bandOf(code, stat, value) {
  const range = STAT_RANGES[code]?.[stat];
  const v = Number(value);
  if (!range || !Number.isInteger(v)) return null;
  const [lo, hi] = range;
  if (v < lo || v > hi) return null;
  const width = (hi - lo + 1) / 5;
  const i = Math.floor((v - lo) / width);
  return { lo: lo + i * width, hi: lo + (i + 1) * width - 1 };
}

/**
 * Where a roll sits in its range: 0 at the bottom, 1 at the top, null outside
 * it. For reading an offer ("262 attack: 51% into the mythic range").
 * @param {string} code @param {string} stat @param {unknown} value
 */
export function rollPosition(code, stat, value) {
  const range = STAT_RANGES[code]?.[stat];
  const v = Number(value);
  if (!range || !Number.isFinite(v)) return null;
  const [lo, hi] = range;
  if (v < lo || v > hi) return null;
  return hi === lo ? 1 : (v - lo) / (hi - lo);
}
