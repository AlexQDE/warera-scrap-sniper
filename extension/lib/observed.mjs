// @ts-check
// The player's own history, replayed: every piece they got (crafted, opened
// from a case, bought on the market, looted in battle) with what it cost,
// what became of it (sold by them, scrapped, still held), and the result by
// activity. Pure functions over the compact rows the worker's history store
// keeps (api.reduceRow). The method was checked on 2026-10-05 against the
// community ledger site, since gone offline; these rules are the reference.
//   cost   crafted: the recipe at the craft day's prices of scraps and steel
//          opened:  the case's price that day (what it would have sold for)
//          bought:  the money paid           looted: nothing
//   fate   held, sold (a later market row with the player as seller, at its
//          money) or scrapped (a later dismantle, the scraps back at that
//          day's scrap price). A sale gives the piece a new id, so a fate is
//          tied to its piece by the item id, else by the same code and stats
//          acquired at the time the row says the seller got it (the closest
//          of identical pieces: they are interchangeable), else by the same
//          code and stats got before it (a relisted piece's "acquired at"
//          moves to when it came back from the market)
//   price  a code's price on a day: the game's daily average when on record,
//          else the median unit price of the player's own trades that day,
//          else the nearest day on record, flagged approximate
import { craftRecipe } from "./ladder.mjs";
import { describeCode } from "./craftdata.mjs";

/** @typedef {{ x: string, y: string, a: string, c?: string, q?: number, m?: number, d?: number, i?: string, ic?: string, k?: Record<string, number>, la?: string, l?: string }} Row */
/** How close a piece's "acquired at" must be to an acquisition's time to be that piece. */
export const ACQUIRED_WITHIN_MS = 5000;
/** @typedef {Record<string, Record<string, number>>} Averages code -> UTC day -> average price */
/** @typedef {"crafted" | "opened" | "bought" | "looted" | "unknown"} Source */
/**
 * @typedef {{
 *   id: string, code: string, rarity: string | null, slot: string | null, tier: number | null,
 *   skills: Record<string, number> | null, source: Source, via: string | null, at: string | null,
 *   cost: number | null, approx: boolean,
 *   fate: "held" | "sold" | "scrapped", proceeds: number | null, goneAt: string | null, sellsHours: number | null
 * }} Piece
 */

/** The UTC day of an ISO time, the day the game's averages are keyed by. @param {unknown} iso */
export const dayOf = (iso) => String(iso ?? "").slice(0, 10);
/** The player's local calendar day of an ISO time ("2026-10-07"). @param {unknown} iso */
export const localDayOf = (iso) => {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** @param {ReadonlyArray<number>} xs */
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

/**
 * A pricer over the game's averages and the player's own trades.
 * @param {Averages | null | undefined} averages @param {ReadonlyArray<Row>} rows
 * @returns {(code: string, day: string) => { value: number | null, approx: boolean }}
 */
export function makePricer(averages, rows) {
  /** @type {Map<string, number[]>} code|day -> unit prices of the player's own trades */
  const own = new Map();
  for (const r of rows)
    if (r.y === "trading" && r.c && r.m && r.q) {
      const key = `${r.c}|${dayOf(r.a)}`;
      const list = own.get(key) ?? [];
      list.push(r.m / r.q);
      own.set(key, list);
    }
  /** @type {Map<string, string[]>} */
  const days = new Map();
  return (code, day) => {
    const table = averages?.[code];
    if (table && table[day] > 0) return { value: table[day], approx: false };
    const mine = own.get(`${code}|${day}`);
    if (mine?.length) return { value: median(mine), approx: false };
    if (!table) return { value: null, approx: false };
    let list = days.get(code);
    if (!list) {
      list = Object.keys(table)
        .filter((d) => table[d] > 0)
        .sort();
      days.set(code, list);
    }
    if (!list.length) return { value: null, approx: false };
    const before = list.filter((d) => d < day).at(-1);
    const near = before ?? list[0];
    return { value: table[near], approx: true };
  };
}

/** @param {string} a @param {string} b */
const byTime = (a, b) => Date.parse(a) - Date.parse(b);

/**
 * Every piece the player got, with its cost and its fate; the wooden cases'
 * resource outcomes; the player's resource trades. A fate attaches to the
 * latest acquisition of that item id before it that has none yet; a fate
 * with no acquisition on record becomes a piece of source "unknown" (its
 * proceeds still count, it has no cost).
 * @param {ReadonlyArray<Row>} rows
 * @param {{ averages?: Averages | null, steelMode?: "random" | "chosen" }} [options]
 */
export function replayHistory(
  rows,
  { averages = {}, steelMode = "random" } = {},
) {
  const price = makePricer(averages, rows);
  const sorted = [...rows].sort((a, b) => byTime(a.a, b.a));
  /** @type {Piece[]} */
  const pieces = [];
  /** @type {Map<string, Piece[]>} */
  const byItem = new Map();
  /** @type {Map<string, Piece[]>} acquisitions by code, for fates tied by the time the piece was got */
  const byCode = new Map();
  /** @type {Array<{ at: string, code: string, q: number, value: number | null, cost: number | null, approx: boolean }>} */
  const wooden = [];
  /** @type {Record<string, { qty: number, spent: number, sold: number, earned: number }>} */
  const trades = {};
  /** @param {string} code */
  const describe = (code) => {
    const item = describeCode(code);
    return {
      rarity: item?.rarity ?? null,
      slot: item?.slot ?? null,
      tier: item?.tier ?? null,
    };
  };
  /** @param {Row} r @param {Source} source @param {number | null} cost @param {boolean} approx @param {string | null} via */
  const acquire = (r, source, cost, approx, via) => {
    if (!r.i || !r.ic) return null;
    const piece = /** @type {Piece} */ ({
      id: r.i,
      code: r.ic,
      ...describe(r.ic),
      skills: r.k ?? null,
      source,
      via,
      at: r.a,
      cost: cost == null ? null : Math.round(cost * 1e6) / 1e6,
      approx,
      fate: "held",
      proceeds: null,
      goneAt: null,
      sellsHours: null,
    });
    pieces.push(piece);
    byItem.set(r.i, [...(byItem.get(r.i) ?? []), piece]);
    if (source !== "unknown") {
      const list = byCode.get(r.ic) ?? [];
      list.push(piece);
      byCode.set(r.ic, list);
    }
    return piece;
  };
  /** @param {Row} r @param {"sold" | "scrapped"} kind @param {number | null} proceeds */
  const fate = (r, kind, proceeds) => {
    if (!r.i) return;
    let owned = (byItem.get(r.i) ?? [])
      .filter(
        (p) => p.fate === "held" && p.at != null && byTime(p.at, r.a) <= 0,
      )
      .at(-1);
    const got = r.la ? Date.parse(r.la) : NaN;
    if (!owned && Number.isFinite(got) && r.ic) {
      const stats = JSON.stringify(r.k ?? null);
      let best = Infinity;
      for (const p of byCode.get(r.ic) ?? []) {
        if (p.fate !== "held" || p.at == null) continue;
        const gap = Math.abs(Date.parse(p.at) - got);
        if (
          gap <= ACQUIRED_WITHIN_MS &&
          gap < best &&
          JSON.stringify(p.skills) === stats
        ) {
          best = gap;
          owned = p;
        }
      }
    }
    // A listing taken down and put up again moves "acquired at": the same code and stats got before the fate, the latest.
    if (!owned && r.ic && r.k) {
      const stats = JSON.stringify(r.k);
      owned = (byCode.get(r.ic) ?? [])
        .filter(
          (p) =>
            p.fate === "held" &&
            p.at != null &&
            byTime(p.at, r.a) <= 0 &&
            JSON.stringify(p.skills) === stats,
        )
        .at(-1);
    }
    const wait =
      kind === "sold" && r.l
        ? (Date.parse(r.a) - Date.parse(r.l)) / 3600e3
        : null;
    let target = owned ?? null;
    if (!target) {
      target = acquire(r, "unknown", null, false, null);
      if (target) target.at = null;
    }
    if (!target) return;
    target.fate = kind;
    target.proceeds =
      proceeds == null ? null : Math.round(proceeds * 1e6) / 1e6;
    target.goneAt = r.a;
    target.sellsHours = wait != null && wait >= 0 ? wait : null;
  };
  for (const r of sorted) {
    const day = dayOf(r.a);
    if (r.y === "craftItem") {
      const rarity = describe(r.ic ?? "").rarity;
      const recipe = rarity
        ? craftRecipe(rarity, { chosen: steelMode === "chosen" })
        : null;
      const s = price("scraps", day);
      const t = price("steel", day);
      const scraps = recipe?.scraps ?? r.q ?? null;
      const cost =
        recipe && scraps != null && s.value != null && t.value != null
          ? scraps * s.value + recipe.steel * t.value
          : null;
      acquire(r, "crafted", cost, s.approx || t.approx, null);
    } else if (r.y === "openCase") {
      if (r.i) {
        const p = price(r.c ?? "", day);
        acquire(r, "opened", p.value, p.approx, r.c ?? null);
      } else if (r.c) {
        // a wooden case gives resources, no piece: valued at that resource's price, cost the wooden case's
        const v = price(r.c, day);
        const c = price("woodenCase", day);
        wooden.push({
          at: r.a,
          code: r.c,
          q: r.q ?? 0,
          value: v.value == null ? null : (r.q ?? 0) * v.value,
          cost: c.value,
          approx: v.approx || c.approx,
        });
      }
    } else if (r.y === "battleLoot") acquire(r, "looted", 0, false, null);
    else if (r.y === "itemMarket") {
      if (r.d === 1) acquire(r, "bought", r.m ?? null, false, null);
      else if (r.d === -1) fate(r, "sold", r.m ?? null);
    } else if (r.y === "dismantleItem") {
      const s = price("scraps", day);
      fate(r, "scrapped", s.value == null ? null : (r.q ?? 0) * s.value);
    } else if (r.y === "trading" && r.c) {
      const t = (trades[r.c] ??= { qty: 0, spent: 0, sold: 0, earned: 0 });
      if (r.d === 1) {
        t.qty += r.q ?? 0;
        t.spent += r.m ?? 0;
      } else if (r.d === -1) {
        t.sold += r.q ?? 0;
        t.earned += r.m ?? 0;
      }
    }
  }
  return { pieces, wooden, trades };
}

/** @param {ReadonlyArray<number | null | undefined>} xs */
const sum = (xs) => xs.reduce((/** @type {number} */ s, x) => s + (x ?? 0), 0);

/**
 * The result of one set of pieces: what they cost, what came of them (sold,
 * scrapped, or held at `valueOf`), and the result where both are known.
 * "realized" counts the pieces that are gone, "estimated" adds the held
 * ones at what they sell for.
 * @param {ReadonlyArray<Piece>} pieces @param {(p: Piece) => number | null} valueOf
 */
export function outcome(pieces, valueOf) {
  const gone = pieces.filter((p) => p.fate !== "held");
  const held = pieces.filter((p) => p.fate === "held");
  const goneKnown = gone.filter((p) => p.cost != null && p.proceeds != null);
  const heldValues = held.map((p) => ({ p, v: valueOf(p) }));
  const heldKnown = heldValues.filter((x) => x.v != null && x.p.cost != null);
  const realized = sum(goneKnown.map((p) => (p.proceeds ?? 0) - (p.cost ?? 0)));
  return {
    n: pieces.length,
    cost: sum(pieces.map((p) => p.cost)),
    costUnknown: pieces.filter((p) => p.cost == null).length,
    approx: pieces.filter((p) => p.approx).length,
    sold: gone.filter((p) => p.fate === "sold").length,
    scrapped: gone.filter((p) => p.fate === "scrapped").length,
    proceeds: sum(gone.map((p) => p.proceeds)),
    held: held.length,
    heldValue: sum(heldValues.map((x) => x.v)),
    heldPriced: heldValues.filter((x) => x.v != null).length,
    realized,
    realizedKnown: goneKnown.length,
    estimated:
      realized + sum(heldKnown.map((x) => (x.v ?? 0) - (x.p.cost ?? 0))),
    estimatedKnown: goneKnown.length + heldKnown.length,
  };
}

/**
 * The window's view by activity: the pieces got in it (crafted, opened,
 * bought, looted), each set's outcome, per case and per crafted tier; what
 * was sold or scrapped in it whatever its age (the window's money); the
 * wooden cases opened in it.
 * @param {ReturnType<typeof replayHistory>} history
 * @param {{ from: string, to: string, dayOf?: (iso: string | null) => string, valueOf: (p: Piece) => number | null }} input
 */
export function windowView(
  history,
  { from, to, dayOf: day = localDayOf, valueOf },
) {
  const inWindow = (/** @type {string | null} */ iso) => {
    const d = iso ? day(iso) : "";
    return d >= from && d <= to;
  };
  const got = history.pieces.filter((p) => inWindow(p.at));
  /** @param {Source} s */
  const of = (s) =>
    outcome(
      got.filter((p) => p.source === s),
      valueOf,
    );
  const gone = history.pieces.filter(
    (p) => p.fate !== "held" && inWindow(p.goneAt),
  );
  const goneKnown = gone.filter((p) => p.cost != null && p.proceeds != null);
  const wooden = history.wooden.filter((w) => inWindow(w.at));
  /** @type {Record<string, ReturnType<typeof outcome>>} */
  const cases = {};
  for (const code of new Set(
    got.filter((p) => p.source === "opened").map((p) => p.via ?? "?"),
  ))
    cases[code] = outcome(
      got.filter((p) => p.source === "opened" && (p.via ?? "?") === code),
      valueOf,
    );
  /** @type {Record<string, ReturnType<typeof outcome>>} */
  const tiers = {};
  for (const r of new Set(
    got.filter((p) => p.source === "crafted").map((p) => p.rarity ?? "?"),
  ))
    tiers[r] = outcome(
      got.filter((p) => p.source === "crafted" && (p.rarity ?? "?") === r),
      valueOf,
    );
  return {
    crafted: of("crafted"),
    opened: of("opened"),
    bought: of("bought"),
    looted: of("looted"),
    cases,
    tiers,
    wooden: {
      n: wooden.length,
      value: sum(wooden.map((w) => w.value)),
      cost: sum(wooden.map((w) => w.cost)),
    },
    money: {
      n: gone.length,
      sold: gone.filter((p) => p.fate === "sold").length,
      scrapped: gone.filter((p) => p.fate === "scrapped").length,
      proceeds: sum(gone.map((p) => p.proceeds)),
      realized: sum(goneKnown.map((p) => (p.proceeds ?? 0) - (p.cost ?? 0))),
      known: goneKnown.length,
      unknownCost: gone.filter((p) => p.cost == null).length,
    },
  };
}
