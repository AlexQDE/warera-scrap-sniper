// @ts-check
// The craft board: one row per tier, what a craft costs at the observed asks
// and what it is worth at the game's own average item prices, random slot
// and chosen slot side by side. Pure functions over the scrap and steel
// books and the `avg` cache (gameStat.getEquipmentAvgByCode, the "Current
// value" the game prints for every item: a mean of recent sales).
//
//   cost    the tier's scraps walked through the scrap asks plus the steel
//           fee walked through the steel asks (CRAFT_STEEL, doubled for a
//           chosen slot); no price past the observed depth, never a guess
//   random  expected value = sum over the six slots of odds x average; only
//           when every slot has an average, else "k of 6"
//   chosen  the slot whose average is highest, at the chosen-slot cost
//   floor   a bad roll dismantled at once gives the tier's scraps back at the
//           scrap bid; what is really lost is the cost minus that
import { RARITIES, SLOTS, GEAR_CODES } from "./items.mjs";
import { CRAFT_STEEL, SCRAP_LADDER, RANDOM_SLOT_ODDS } from "./ladder.mjs";
import { quote, positive } from "./quality.mjs";

/** @typedef {{ price: number, quantity: number }} Level */
/** @typedef {{ value: number | null, complete: boolean, missing: string[] }} Cost */

/**
 * The cost of one craft: scraps and steel each walked through their asks.
 * @param {{ scraps: number, steel: number, scrapAsks?: ReadonlyArray<Level> | null, steelAsks?: ReadonlyArray<Level> | null }} input
 * @returns {Cost}
 */
export function craftCost({ scraps, steel, scrapAsks, steelAsks }) {
  const s = quote(scraps, scrapAsks ? [...scrapAsks] : []);
  const t = quote(steel, steelAsks ? [...steelAsks] : []);
  const missing = [
    ...(s.complete ? [] : ["scraps"]),
    ...(t.complete ? [] : ["steel"]),
  ];
  return {
    value:
      s.complete && t.complete
        ? Math.round(((s.value ?? 0) + (t.value ?? 0)) * 1e6) / 1e6
        : null,
    complete: missing.length === 0,
    missing,
  };
}

/** @param {number | null | undefined} value @param {number | null | undefined} cost */
const roi = (value, cost) =>
  value == null || cost == null || cost <= 0 ? null : (value - cost) / cost;

/**
 * @typedef {{ code: string, slot: string, odds: number, avg: number | null }} SlotValue
 * @typedef {{
 *   rarity: string, tier: number, scraps: number, steelRandom: number, steelChosen: number,
 *   slots: SlotValue[], covered: number,
 *   costRandom: Cost, costChosen: Cost,
 *   evRandom: number | null, roiRandom: number | null,
 *   best: SlotValue | null, roiChosen: number | null,
 *   scrapsBack: number | null, lossRandom: number | null
 * }} TierRow
 */

/**
 * One row per tier, common to mythic.
 * @param {{ scrapAsks?: ReadonlyArray<Level> | null, scrapBids?: ReadonlyArray<Level> | null, steelAsks?: ReadonlyArray<Level> | null, avg?: Record<string, unknown> | null }} input
 * @returns {TierRow[]}
 */
export function tierBoard({ scrapAsks, scrapBids, steelAsks, avg }) {
  return RARITIES.map((rarity, i) => {
    const r = /** @type {keyof typeof SCRAP_LADDER} */ (rarity);
    const scraps = SCRAP_LADDER[r];
    const steelRandom = CRAFT_STEEL[r];
    const steelChosen = steelRandom * 2;
    const codes = [GEAR_CODES[rarity].weapon, ...GEAR_CODES[rarity].gear];
    const slotNames = ["weapon", ...SLOTS];
    const slots = codes.map((code, k) => ({
      code,
      slot: slotNames[k],
      odds: RANDOM_SLOT_ODDS[
        /** @type {keyof typeof RANDOM_SLOT_ODDS} */ (slotNames[k])
      ],
      avg: positive(avg?.[code]),
    }));
    const covered = slots.filter((s) => s.avg != null).length;
    const costRandom = craftCost({
      scraps,
      steel: steelRandom,
      scrapAsks,
      steelAsks,
    });
    const costChosen = craftCost({
      scraps,
      steel: steelChosen,
      scrapAsks,
      steelAsks,
    });
    const evRandom =
      covered === slots.length
        ? Math.round(
            slots.reduce((sum, s) => sum + s.odds * (s.avg ?? 0), 0) * 1e6,
          ) / 1e6
        : null;
    const best = slots
      .filter((s) => s.avg != null)
      .reduce(
        (top, s) => (top == null || (s.avg ?? 0) > (top.avg ?? 0) ? s : top),
        /** @type {SlotValue | null} */ (null),
      );
    const back = quote(scraps, scrapBids ? [...scrapBids] : []);
    const scrapsBack = back.complete ? back.value : null;
    return {
      rarity,
      tier: i + 1,
      scraps,
      steelRandom,
      steelChosen,
      slots,
      covered,
      costRandom,
      costChosen,
      evRandom,
      roiRandom: roi(evRandom, costRandom.value),
      best,
      roiChosen: roi(best?.avg ?? null, costChosen.value),
      scrapsBack,
      lossRandom:
        scrapsBack != null && costRandom.value != null
          ? Math.round((costRandom.value - scrapsBack) * 1e6) / 1e6
          : null,
    };
  });
}

/**
 * The tier that pays best right now, by random-craft ROI, else by chosen-slot
 * ROI when no tier is fully covered. null when nothing is priced.
 * @param {ReadonlyArray<TierRow>} rows
 */
export function bestTier(rows) {
  const by = (/** @type {"roiRandom" | "roiChosen"} */ key) =>
    rows
      .filter((r) => r[key] != null)
      .reduce(
        (top, r) =>
          top == null || (r[key] ?? -Infinity) > (top[key] ?? -Infinity)
            ? r
            : top,
        /** @type {TierRow | null} */ (null),
      );
  const random = by("roiRandom");
  if (random) return { row: random, mode: /** @type {const} */ ("random") };
  const chosen = by("roiChosen");
  return chosen ? { row: chosen, mode: /** @type {const} */ ("chosen") } : null;
}
