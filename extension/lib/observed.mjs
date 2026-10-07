// @ts-check
// The player's own pieces, replayed from the game's transaction feed: what
// each one cost to get (crafted at the craft day's average input prices, or
// bought at its price), what became of it (sold by the player, scrapped, or
// still held), and the day's result. Pure functions over the rows the
// worker's feed store holds (api.fetchOwnFeed). The method was checked on
// 2026-10-05 against the community ledger site, which has since gone
// offline; these rules are the reference now (docs/GAME-FACTS.md §10).
//   cost     a craft: the recipe at the craft day's average scrap and steel
//            prices, with the random-craft steel fee unless the player says
//            they choose the slot; a buy: the money paid
//   fate     held, sold (a later market row with the piece's item id and
//            the player as seller) or scrapped (a later dismantle with it)
//   result   by the day a piece was sold or scrapped, proceeds against cost
import { craftRecipe } from "./ladder.mjs";
import { describeCode } from "./craftdata.mjs";
import { keyStat } from "./stats.mjs";
import { nonNegative as money } from "./quality.mjs";

/** @typedef {{ txId: string, id: string, code: string, skills: Record<string, number> | null, at: string, scraps: number }} CraftRow */
/** @typedef {{ txId: string, itemId: string | null, code: string | null, skills?: Record<string, number> | null, at: string, money: number, seller: string | null, buyer: string | null, listedAt?: string | null }} SaleRow */
/** @typedef {{ txId: string, itemId: string | null, code: string | null, skills?: Record<string, number> | null, at: string, scraps: number }} DismantleRow */
/** @typedef {Record<string, Record<string, number>>} Averages code -> UTC day -> average price */
/**
 * @typedef {{
 *   id: string, txId: string, code: string, rarity: string | null, tier: number | null, slot: string | null,
 *   skills: Record<string, number> | null, stat: string | null,
 *   source: "crafted" | "bought" | "unknown", at: string | null,
 *   cost: number | null, costBasis: string, scraps: number | null, steel: number | null, steelMode: "random" | "chosen",
 *   scrapPrice: number | null, steelPrice: number | null, priceDay: string | null,
 *   fate: "held" | "sold" | "scrapped", proceeds: number | null, proceedsBasis: string | null,
 *   goneAt: string | null, listedAt: string | null, sellsHours: number | null
 * }} Piece
 */

/** The UTC day of an ISO time, the day the feed's averages are keyed by. @param {unknown} iso */
export const dayOf = (iso) => String(iso ?? "").slice(0, 10);
/** The player's local calendar day of an ISO time ("2026-10-07"). @param {unknown} iso */
export const localDayOf = (iso) => {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * The average price of `code` on `day`, else the latest day on record
 * before it (a piece older than the table falls back), with the day used.
 * null when the table has nothing on or before the day.
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

/** @param {string} a @param {string} b */
const byTime = (a, b) => Date.parse(a) - Date.parse(b);

/**
 * Every piece the player got (crafted, or bought on the market) with its
 * cost and its fate, plus the pieces the player sold or scrapped whose
 * acquisition is older than the store holds (source "unknown", no cost:
 * the proceeds still count). A fate attaches to the latest acquisition of
 * that item id before it that has no fate yet.
 * @param {{ crafts?: ReadonlyArray<CraftRow> | null, sales?: ReadonlyArray<SaleRow> | null, dismantles?: ReadonlyArray<DismantleRow> | null, me: string | null, averages?: Averages | null, steelMode?: "random" | "chosen" }} input
 * @returns {Piece[]}
 */
export function replayPieces({
  crafts,
  sales = [],
  dismantles = [],
  me,
  averages = {},
  steelMode = "random",
}) {
  /** @type {Piece[]} */
  const pieces = [];
  /** @param {string} code */
  const describe = (code) => {
    const item = describeCode(code);
    return {
      rarity: item?.rarity ?? null,
      tier: item?.tier ?? null,
      slot: item?.slot ?? null,
      stat: keyStat(code),
    };
  };
  for (const c of crafts ?? []) {
    const d = describe(c.code);
    const recipe = d.rarity
      ? craftRecipe(d.rarity, { chosen: steelMode === "chosen" })
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
    pieces.push({
      id: c.id,
      txId: c.txId,
      code: c.code,
      ...d,
      skills: c.skills ?? null,
      source: "crafted",
      at: c.at,
      cost,
      costBasis:
        cost == null
          ? "no average price for that day"
          : `${scraps} scraps × ${scrap.value} + ${steelUnits} steel × ${steel.value}, the day's averages`,
      scraps,
      steel: steelUnits,
      steelMode,
      scrapPrice: scrap.value,
      steelPrice: steel.value,
      priceDay: scrap.day,
      fate: "held",
      proceeds: null,
      proceedsBasis: null,
      goneAt: null,
      listedAt: null,
      sellsHours: null,
    });
  }
  for (const s of sales ?? [])
    if (s.itemId && s.code && me && s.buyer === me && s.seller !== me)
      pieces.push({
        id: s.itemId,
        txId: s.txId,
        code: s.code,
        ...describe(s.code),
        skills: s.skills ?? null,
        source: "bought",
        at: s.at,
        cost: s.money,
        costBasis: "bought on the market",
        scraps: null,
        steel: null,
        steelMode,
        scrapPrice: null,
        steelPrice: null,
        priceDay: null,
        fate: "held",
        proceeds: null,
        proceedsBasis: null,
        goneAt: null,
        listedAt: null,
        sellsHours: null,
      });
  pieces.sort((a, b) => byTime(a.at ?? "", b.at ?? ""));
  /** @type {Map<string, Piece[]>} */
  const byItem = new Map();
  for (const p of pieces) {
    const list = byItem.get(p.id) ?? [];
    list.push(p);
    byItem.set(p.id, list);
  }
  /** @type {Array<{ kind: "sold" | "scrapped", itemId: string, code: string | null, skills: Record<string, number> | null, at: string, txId: string, money: number | null, scraps: number | null, listedAt: string | null }>} */
  const fates = [];
  for (const s of sales ?? [])
    if (s.itemId && me && s.seller === me)
      fates.push({
        kind: "sold",
        itemId: s.itemId,
        code: s.code,
        skills: s.skills ?? null,
        at: s.at,
        txId: s.txId,
        money: s.money,
        scraps: null,
        listedAt: s.listedAt ?? null,
      });
  for (const d of dismantles ?? [])
    if (d.itemId)
      fates.push({
        kind: "scrapped",
        itemId: d.itemId,
        code: d.code,
        skills: d.skills ?? null,
        at: d.at,
        txId: d.txId,
        money: null,
        scraps: d.scraps,
        listedAt: null,
      });
  fates.sort((a, b) => byTime(a.at, b.at));
  for (const f of fates) {
    const owned = (byItem.get(f.itemId) ?? [])
      .filter((p) => p.fate === "held" && byTime(p.at ?? "", f.at) <= 0)
      .at(-1);
    // Scraps that came back are worth the scrap average of the day they came back.
    const back =
      f.kind === "scrapped" ? averageOn(averages, "scraps", dayOf(f.at)) : null;
    const scrapsValue =
      f.kind === "scrapped" && back?.value != null && f.scraps != null
        ? f.scraps * back.value
        : null;
    const proceeds = f.kind === "sold" ? f.money : scrapsValue;
    const proceedsBasis =
      f.kind === "sold"
        ? "sold on the market"
        : scrapsValue == null
          ? "scrapped; no scrap average for that day"
          : `scrapped: ${f.scraps} scraps back at the day's average`;
    const wait =
      f.kind === "sold" && f.listedAt
        ? (Date.parse(f.at) - Date.parse(f.listedAt)) / 3600e3
        : null;
    if (owned) {
      owned.fate = f.kind;
      owned.proceeds = proceeds;
      owned.proceedsBasis = proceedsBasis;
      owned.goneAt = f.at;
      owned.listedAt = f.listedAt;
      owned.sellsHours = wait != null && wait >= 0 ? wait : null;
    } else if (f.code) {
      const piece = /** @type {Piece} */ ({
        id: f.itemId,
        txId: f.txId,
        code: f.code,
        ...describe(f.code),
        skills: f.skills,
        source: "unknown",
        at: null,
        cost: null,
        costBasis: "got before the feed on record",
        scraps: null,
        steel: null,
        steelMode,
        scrapPrice: null,
        steelPrice: null,
        priceDay: null,
        fate: f.kind,
        proceeds,
        proceedsBasis,
        goneAt: f.at,
        listedAt: f.listedAt,
        sellsHours: wait != null && wait >= 0 ? wait : null,
      });
      pieces.push(piece);
      byItem.set(f.itemId, [...(byItem.get(f.itemId) ?? []), piece]);
    }
  }
  return pieces;
}

/** @param {ReadonlyArray<number | null | undefined>} xs */
const sum = (xs) => xs.reduce((/** @type {number} */ s, x) => s + (x ?? 0), 0);

/**
 * The window's result, by the day things happened: what was sold or
 * scrapped in it against its cost, what was crafted and bought in it, and
 * what is held now (any day) at what it sells for. Every sum says how much
 * of it is known.
 * @param {ReadonlyArray<Piece>} pieces
 * @param {{ from: string, to: string, dayOf?: (iso: string | null) => string, valueOf: (piece: Piece) => { value: number | null } | null }} input
 */
export function ledgerSummary(
  pieces,
  { from, to, dayOf: day = localDayOf, valueOf },
) {
  const inWindow = (/** @type {string | null} */ iso) => {
    const d = iso ? day(iso) : "";
    return d >= from && d <= to;
  };
  const gone = pieces.filter((p) => p.fate !== "held" && inWindow(p.goneAt));
  const goneKnown = gone.filter((p) => p.cost != null && p.proceeds != null);
  const crafted = pieces.filter(
    (p) => p.source === "crafted" && inWindow(p.at),
  );
  const bought = pieces.filter((p) => p.source === "bought" && inWindow(p.at));
  const held = pieces.filter((p) => p.fate === "held");
  const heldValues = held.map((p) => valueOf(p)?.value ?? null);
  const covered = heldValues.filter((v) => v != null).length;
  const heldCostKnown = held.filter((p) => p.cost != null).length;
  return {
    gone: {
      n: gone.length,
      sold: gone.filter((p) => p.fate === "sold").length,
      scrapped: gone.filter((p) => p.fate === "scrapped").length,
      proceeds: sum(gone.map((p) => p.proceeds)),
      realized: sum(goneKnown.map((p) => (p.proceeds ?? 0) - (p.cost ?? 0))),
      known: goneKnown.length,
      unknownCost: gone.filter((p) => p.cost == null).length,
      cost: sum(goneKnown.map((p) => p.cost)),
    },
    crafted: {
      n: crafted.length,
      cost: sum(crafted.map((p) => p.cost)),
      costKnown: crafted.filter((p) => p.cost != null).length,
      sold: crafted.filter((p) => p.fate === "sold").length,
      soldProceeds: sum(
        crafted.filter((p) => p.fate === "sold").map((p) => p.proceeds),
      ),
      scrapped: crafted.filter((p) => p.fate === "scrapped").length,
      held: crafted.filter((p) => p.fate === "held").length,
    },
    bought: {
      n: bought.length,
      cost: sum(bought.map((p) => p.cost)),
      sold: bought.filter((p) => p.fate === "sold").length,
      soldProceeds: sum(
        bought.filter((p) => p.fate === "sold").map((p) => p.proceeds),
      ),
      held: bought.filter((p) => p.fate === "held").length,
    },
    held: {
      n: held.length,
      cost: sum(held.map((p) => p.cost)),
      costKnown: heldCostKnown,
      value: sum(heldValues),
      covered,
      // worth against cost, only when every held piece is priced and costed
      unrealized:
        held.length && covered === held.length && heldCostKnown === held.length
          ? sum(heldValues) - sum(held.map((p) => p.cost))
          : null,
    },
  };
}
