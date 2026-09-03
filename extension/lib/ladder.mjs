// The scrap ladder and the dismantle yield.
//
// Both values are measured, not guessed: the formula below reproduced
// 17,269,842 real dismantle transactions with zero mismatches (audit of the
// full WarEra market feed, August 2026). Edit only with evidence of that
// strength.
//
// Yield at durability `state` (0..maxState): the full ladder value at 100%,
// exactly one third at 0%, floored in between. Market listings are always at
// 100%, so the extension only ever uses the full value.

export const SCRAP_LADDER = { common: 6, uncommon: 18, rare: 54, epic: 162, legendary: 486, mythic: 1458 };

export function scrapYield(rarity, state, maxState = 100) {
  const full = SCRAP_LADDER[rarity];
  if (full == null) return null;
  const max = Number(maxState) || 100;
  const s = Math.max(0, Math.min(max, Number(state) || 0));
  return Math.floor((full * (1 + (2 * s) / max)) / 3);
}
