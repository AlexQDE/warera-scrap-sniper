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
const STAT_RE = /^\+?(\d{1,6})$/;
const NAMED_STAT_RE =
  /^(?:attack|defense|defence|damage|health|hp|power|armou?r|stat)\s*[:+]?\s*(\d{1,6})$/i;

/**
 * The numbers an offer row prints, read off its visible lines (as
 * dom.offerRows lists them): the durability "NN%" and the stat value, the
 * bare integer that is neither the price (the number right before BUY) nor
 * the durability. Fails closed: a row missing either is "unreadable" with
 * the reason, never guessed. Layout read from synthetic fixtures; see the
 * release checklist for the live check.
 * @param {ReadonlyArray<string> | null | undefined} lines
 */
export function readStats(lines) {
  const list = (lines ?? []).map((l) => String(l ?? "").trim());
  const buy = list.findIndex((l) => /^buy$/i.test(l));
  const priceIndex = buy > 0 ? buy - 1 : -1;
  let durability = null;
  let stat = null;
  for (const [i, line] of list.entries()) {
    if (i === priceIndex) continue;
    if (buy >= 0 && i > buy) break;
    const d = DURABILITY_RE.exec(line);
    if (d && durability == null && Number(d[1]) <= 100) {
      durability = Number(d[1]);
      continue;
    }
    const s = NAMED_STAT_RE.exec(line) ?? STAT_RE.exec(line);
    if (s && stat == null) stat = Number(s[1]);
  }
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
  return { readable: reason == null, durability, stat, reason };
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
