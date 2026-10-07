// @ts-check
// What one offer row tells on its own, kept apart from what the market data
// tells about it. Three independent dimensions, never folded into one flag:
//   stats     did the row's own numbers read (durability, the stat value)?
//   market    is there a scrap quote to value it against?
//   freshness is that quote current?
// A failed sales read touches the resale column only; it cannot change how
// many rows were readable. Pure; equipment.mjs renders the result.
import { RARITIES, WEAPONS, SLOTS } from "./items.mjs";
import { percentileRank } from "./resale.mjs";

/**
 * The market item code of a slot at a rarity: armour carries its tier digit
 * ("boots" + legendary -> "boots5"), weapons are named by rarity ("jet").
 * A weapon slot read off a skin name ("winterJet" -> jet) is already a code.
 * @param {string | null | undefined} slot @param {string | null | undefined} rarity
 */
export function codeFor(slot, rarity) {
  const tier = RARITIES.indexOf(String(rarity ?? ""));
  if (tier < 0 || !slot) return null;
  if (SLOTS.includes(slot)) return `${slot}${tier + 1}`;
  if (WEAPONS.includes(slot)) return WEAPONS[tier] === slot ? slot : null;
  return null;
}

const DURABILITY_RE = /^(\d{1,3})\s*%$/;
const STAT_RE = /^\+?(\d{1,6})\s*%?$/;
const NAMED_STAT_RE =
  /^(?:attack|defense|defence|damage|health|hp|power|armou?r|stat)\s*[:+]?\s*(\d{1,6})\s*%?$/i;

/**
 * The numbers an offer row prints, read off its visible lines (as
 * dom.offerRows lists them). The live rows (2026-10-07): a weapon prints
 * `101`, `16%`, `100%` (attack, crit, durability), an armour piece `12%`,
 * `100%` (its stat, durability) or `46`, `100%` for armor. So the
 * durability is the LAST `NN%` line before the price (the line right before
 * BUY), and every number printed before it is a stat, in order. Fails
 * closed: a row with no durability or no stat is "unreadable" with the
 * reason, never guessed.
 * @param {ReadonlyArray<string> | null | undefined} lines
 * @returns {{ readable: boolean, durability: number | null, stat: number | null, stats: number[], reason: string | null }}
 */
export function readStats(lines) {
  const list = (lines ?? []).map((l) => String(l ?? "").trim());
  const buy = list.findIndex((l) => /^buy$/i.test(l));
  const priceIndex = buy > 0 ? buy - 1 : -1;
  /** @type {Array<{ value: number, pct: boolean }>} */
  const numbers = [];
  for (const [i, line] of list.entries()) {
    if (i === priceIndex) continue;
    if (buy >= 0 && i > buy) break;
    const s = NAMED_STAT_RE.exec(line) ?? STAT_RE.exec(line);
    if (s) numbers.push({ value: Number(s[1]), pct: DURABILITY_RE.test(line) });
  }
  let durabilityAt = -1;
  for (let i = numbers.length - 1; i >= 0; i--)
    if (numbers[i].pct && numbers[i].value <= 100) {
      durabilityAt = i;
      break;
    }
  const durability = durabilityAt >= 0 ? numbers[durabilityAt].value : null;
  const stats = (durabilityAt >= 0 ? numbers.slice(0, durabilityAt) : numbers)
    .filter((n) => !(n.pct && n.value > 100))
    .map((n) => n.value);
  const stat = stats.length ? stats[0] : null;
  const reason =
    buy < 0
      ? "no BUY control"
      : durability == null && stat == null
        ? "no durability or stat"
        : durability == null
          ? "no durability"
          : stat == null
            ? "no stat value"
            : null;
  return { readable: reason == null, durability, stat, stats, reason };
}

/**
 * @typedef {{ stats?: { readable: boolean } | null, price?: number | null, rarity?: string | null, code?: string | null }} OfferLike
 */

/**
 * Counts for the summary line: scanned rows, rows whose own numbers read,
 * rows with a readable price and a known rarity. None of these depends on
 * the quote or the sales read.
 * @param {ReadonlyArray<OfferLike>} rows
 */
export function summarizeOffers(rows) {
  let readable = 0;
  let priced = 0;
  let rarityKnown = 0;
  for (const r of rows) {
    if (r.stats?.readable) readable++;
    if (r.price != null) priced++;
    if (r.rarity) rarityKnown++;
  }
  return { scanned: rows.length, readable, priced, rarityKnown };
}

/**
 * Each row's stat percentile among the other listed pieces of the same item
 * code (its peers), once eight peers read. Index-aligned with `rows`.
 * @param {ReadonlyArray<{ code?: string | null, stats?: { stat?: number | null } | null }>} rows
 */
export function statRanks(rows) {
  /** @type {Map<string, number[]>} */
  const byCode = new Map();
  rows.forEach((r, i) => {
    const stat = r.stats?.stat;
    if (!r.code || typeof stat !== "number") return;
    const list = byCode.get(r.code) ?? [];
    list.push(i);
    byCode.set(r.code, list);
  });
  return rows.map((r, i) => {
    const stat = r.stats?.stat;
    if (!r.code || typeof stat !== "number") return null;
    const peers = (byCode.get(r.code) ?? [])
      .filter((j) => j !== i)
      .map((j) => rows[j].stats?.stat);
    return percentileRank(stat, peers);
  });
}

/**
 * The three dimensions of one row, read independently.
 * @param {{ stats?: { readable: boolean } | null, hasQuote: boolean, fresh: boolean, error?: string | null, salesError?: string | null, salesLoading?: boolean, resale?: { status: string } | null, ownItem?: boolean }} input
 */
export function offerDimensions({
  stats,
  hasQuote,
  fresh,
  error = null,
  salesError = null,
  salesLoading = false,
  resale = null,
  ownItem = true,
}) {
  return {
    stats: stats?.readable ? "readable" : "unreadable",
    market: hasQuote ? "available" : error ? "error" : "missing",
    freshness: !hasQuote ? "missing" : fresh ? "fresh" : "stale",
    resale: !ownItem
      ? "other-item"
      : salesError
        ? "error"
        : resale?.status === "ok"
          ? "ok"
          : resale?.status === "insufficient"
            ? "insufficient"
            : salesLoading
              ? "loading"
              : "none",
  };
}
