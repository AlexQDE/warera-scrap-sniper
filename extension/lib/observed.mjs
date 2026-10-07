// @ts-check
// The player's own crafts, replayed from the game's transaction feed: what
// each craft cost, what became of it, and what its roll clears at now. Pure
// functions over rows the worker already validated (api.fetchOwnActivity).
//
// The method was checked on 2026-10-05, for one account, against the
// community ledger site: cost reproduced to the cent, clears within 2% on
// every held piece (docs/GAME-FACTS.md §10). That site has since gone
// offline (Firebase "Site Not Found" on 2026-10-07); the extension's own
// rules, the three below, are the reference now.
//   cost    the recipe at the craft day's average scrap and steel prices
//           (itemTrading.getItemTrading), with the random-craft steel fee
//           unless the player says they choose the slot
//   fate    held, sold (an item-market row with the same item id and the
//           player as seller) or scrapped (a dismantle row with that id)
//   clears  the median of recent sales of the same roll value; of its
//           fifth-of-range band when the roll itself has too few; of the
//           item when the band has too few
import { RARITIES } from "./items.mjs";
import { craftRecipe } from "./ladder.mjs";
import { describeCode } from "./craftdata.mjs";
import { keyStat, bandOf } from "./stats.mjs";
import { nonNegative as money } from "./quality.mjs";

/** @typedef {{ id: string, code: string, skills: Record<string, number> | null, at: string, scraps: number }} CraftRow */
/** @typedef {{ itemId: string | null, code: string | null, at: string, money: number, seller: string | null, buyer: string | null }} SaleRow */
/** @typedef {{ itemId: string | null, code: string | null, at: string, scraps: number }} DismantleRow */
/** @typedef {Record<string, Record<string, number>>} Averages code -> UTC day -> average price */
/** @typedef {{ price: number, skills?: Record<string, number> | null }} PricedFill */

/** Fills of the same roll (or band, or item) needed before a clearing price is quoted. */
export const MIN_ROLL_SAMPLE = 5;
/** The headline counts epic and up, as the ledger site does; lower tiers are listed, not summed. */
export const COUNTED_FROM = RARITIES.indexOf("epic");

/** The UTC day of an ISO time, the day the feed and the averages are keyed by. @param {unknown} iso */
export const dayOf = (iso) => String(iso ?? "").slice(0, 10);

/**
 * The average price of `code` on `day`, else the latest day on record
 * before it (the feed's averages lag the current day by nothing, but a
 * craft older than the table falls back), with the day used. null when the
 * table has nothing on or before the day.
 * @param {Averages | null | undefined} averages @param {string} code @param {string} day
 */
export function averageOn(averages, code, day) {
  const table = averages?.[code];
  if (!table) return { value: null, day: null };
  if (money(table[day]) != null) return { value: table[day], day };
  const days = Object.keys(table)
    .filter((d) => d < day && money(table[d]) != null)
    .sort();
  const last = days[days.length - 1];
  return last ? { value: table[last], day: last } : { value: null, day: null };
}

/** @param {ReadonlyArray<number>} xs */
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

/**
 * Every craft with its cost basis and its fate.
 * @param {{ crafts: ReadonlyArray<CraftRow> | null | undefined, sales?: ReadonlyArray<SaleRow>, dismantles?: ReadonlyArray<DismantleRow>, me: string | null, averages?: Averages | null, steelMode?: "random" | "chosen" }} input
 */
export function replayCrafts({
  crafts,
  sales = [],
  dismantles = [],
  me,
  averages = {},
  steelMode = "random",
}) {
  const soldById = new Map();
  for (const s of sales)
    if (s.itemId && me && s.seller === me) soldById.set(s.itemId, s);
  const scrappedById = new Map();
  for (const d of dismantles) if (d.itemId) scrappedById.set(d.itemId, d);
  return (crafts ?? []).map((c) => {
    const item = describeCode(c.code);
    const rarity = item?.rarity ?? null;
    const recipe = rarity
      ? craftRecipe(rarity, { chosen: steelMode === "chosen" })
      : null;
    const day = dayOf(c.at);
    const scrap = averageOn(averages, "scraps", day);
    const steel = averageOn(averages, "steel", day);
    const scraps = recipe?.scraps ?? c.scraps;
    const steelUnits = recipe?.steel ?? null;
    const cost =
      scrap.value != null && steel.value != null && steelUnits != null
        ? Math.round((scraps * scrap.value + steelUnits * steel.value) * 1e6) /
          1e6
        : null;
    const sold = soldById.get(c.id) ?? null;
    const scrapped = sold ? null : (scrappedById.get(c.id) ?? null);
    // Scraps that came back are worth the scrap average of the day they came back.
    const back = scrapped
      ? averageOn(averages, "scraps", dayOf(scrapped.at))
      : null;
    const scrapsValue =
      scrapped && back?.value != null ? scrapped.scraps * back.value : null;
    return {
      id: c.id,
      code: c.code,
      rarity,
      tier: item?.tier ?? null,
      slot: item?.slot ?? null,
      skills: c.skills ?? null,
      stat: keyStat(c.code),
      at: c.at,
      day,
      scraps,
      steel: steelUnits,
      steelMode,
      scrapPrice: scrap.value,
      steelPrice: steel.value,
      priceDay: scrap.day,
      cost,
      fate: sold ? "sold" : scrapped ? "scrapped" : "held",
      proceeds: sold ? sold.money : scrapsValue,
      proceedsBasis: sold
        ? "sold on the market"
        : scrapped
          ? scrapsValue == null
            ? "scrapped; no scrap average for that day"
            : `scrapped: ${scrapped.scraps} scraps back at the day's average`
          : null,
      goneAt: sold?.at ?? scrapped?.at ?? null,
    };
  });
}

/**
 * What a roll clears at: the median of recent sales of the same roll value
 * (the key stat), else of its fifth-of-range band, else of the item; each
 * level needs MIN_ROLL_SAMPLE fills. Fills without a stat (an older cache)
 * count at the item level only.
 * @param {string} code @param {Record<string, number> | null | undefined} skills @param {ReadonlyArray<PricedFill> | null | undefined} fills
 */
export function rollValue(code, skills, fills) {
  const stat = keyStat(code);
  const v = stat && skills ? Number(skills[stat]) : NaN;
  const roll = Number.isInteger(v) ? v : null;
  const priced = (fills ?? []).filter((f) => money(f?.price) != null);
  if (stat && roll != null) {
    const exact = priced.filter((f) => f.skills?.[stat] === roll);
    if (exact.length >= MIN_ROLL_SAMPLE)
      return {
        value: median(exact.map((f) => f.price)),
        level: /** @type {const} */ ("roll"),
        n: exact.length,
        stat,
        roll,
        band: null,
      };
    const band = bandOf(code, stat, roll);
    if (band) {
      const inBand = priced.filter((f) => {
        const x = f.skills?.[stat];
        return typeof x === "number" && x >= band.lo && x <= band.hi;
      });
      if (inBand.length >= MIN_ROLL_SAMPLE)
        return {
          value: median(inBand.map((f) => f.price)),
          level: /** @type {const} */ ("band"),
          n: inBand.length,
          stat,
          roll,
          band,
        };
    }
  }
  if (priced.length >= MIN_ROLL_SAMPLE)
    return {
      value: median(priced.map((f) => f.price)),
      level: /** @type {const} */ ("item"),
      n: priced.length,
      stat,
      roll,
      band: null,
    };
  return {
    value: null,
    level: null,
    n: priced.length,
    stat,
    roll,
    band: null,
  };
}

/**
 * A window of replayed crafts summed the way the ledger site's headline is:
 * epic and up counted, held pieces at what they clear at against their cost,
 * gone pieces at what they brought. Every sum says how much of it is known.
 * @param {ReadonlyArray<ReturnType<typeof replayCrafts>[number]>} entries
 * @param {{ from: string, to: string, valueOf: (entry: ReturnType<typeof replayCrafts>[number]) => { value: number | null } | null }} input
 */
export function craftsSummary(entries, { from, to, valueOf }) {
  const inWindow = entries.filter((e) => e.day >= from && e.day <= to);
  const counted = inWindow.filter(
    (e) => RARITIES.indexOf(String(e.rarity)) >= COUNTED_FROM,
  );
  const held = counted.filter((e) => e.fate === "held");
  const gone = counted.filter((e) => e.fate !== "held");
  const sum = (/** @type {ReadonlyArray<number | null>} */ xs) =>
    xs.reduce((s, x) => (s ?? 0) + (x ?? 0), 0) ?? 0;
  const heldValues = held.map((e) => valueOf(e)?.value ?? null);
  const covered = heldValues.filter((v) => v != null).length;
  const heldCostKnown = held.filter((e) => e.cost != null).length;
  const goneKnown = gone.filter(
    (e) => e.cost != null && e.proceeds != null,
  ).length;
  const realized = sum(
    gone.map((e) =>
      e.cost != null && e.proceeds != null ? e.proceeds - e.cost : null,
    ),
  );
  const goneCost = sum(
    gone.map((e) => (e.cost != null && e.proceeds != null ? e.cost : null)),
  );
  return {
    crafted: inWindow.length,
    counted: counted.length,
    below: inWindow.length - counted.length,
    held: held.length,
    sold: gone.filter((e) => e.fate === "sold").length,
    scrapped: gone.filter((e) => e.fate === "scrapped").length,
    cost: sum(counted.map((e) => e.cost)),
    costKnown: counted.every((e) => e.cost != null),
    heldCost: sum(held.map((e) => e.cost)),
    heldCostKnown,
    atMarket: sum(heldValues),
    covered,
    // the held pieces' worth against their cost, only when every held piece is priced and costed
    unrealized:
      held.length && covered === held.length && heldCostKnown === held.length
        ? sum(heldValues) - sum(held.map((e) => e.cost))
        : null,
    realized,
    realizedPct: goneCost > 0 ? realized / goneCost : null,
    goneKnown,
    proceeds: sum(gone.map((e) => e.proceeds)),
  };
}
