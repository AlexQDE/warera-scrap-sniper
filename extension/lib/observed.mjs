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
//          day's scrap price; a dismantle that returns fewer scraps than the
//          tier's ladder means the piece was worn in battle). A sale gives the piece a new id, so a fate is
//          tied to its piece by the item id, else by the same code and stats
//          acquired at the time the row says the seller got it (the closest
//          of identical pieces: they are interchangeable), else by the same
//          code and stats got before it (a relisted piece's "acquired at"
//          moves to when it came back from the market)
//   price  a code's price on a day: the game's daily average when on record,
//          else the median unit price of the player's own trades that day,
//          else the nearest day on record, flagged approximate
//   slot   a craft with its slot chosen burns twice the steel, and the feed
//          does not say which way a craft was made: the extension's own
//          sighting of the game's button (the row's `p`), else a streak of
//          the same slot too long for a random craft, else random
import { craftRecipe, SCRAP_LADDER } from "./ladder.mjs";
import { describeCode } from "./craftdata.mjs";
import { isToolCode, CASE_DROP_CODES } from "./items.mjs";

/** @typedef {{ x: string, y: string, a: string, c?: string, q?: number, m?: number, d?: number, i?: string, ic?: string, k?: Record<string, number>, la?: string, l?: string, p?: "c" | "r" }} Row */
/** How close a piece's "acquired at" must be to an acquisition's time to be that piece. */
export const ACQUIRED_WITHIN_MS = 5000;
/** @typedef {Record<string, Record<string, number>>} Averages code -> UTC day -> average price */
/** @typedef {"crafted" | "opened" | "bought" | "looted" | "unknown"} Source */
/** How a craft's slot is known: the setting, the press seen in the game's window, a streak, or the random default. @typedef {"setting" | "seen" | "streak" | "default"} ChosenBy */
/**
 * @typedef {{
 *   id: string, code: string, rarity: string | null, slot: string | null, tier: number | null,
 *   skills: Record<string, number> | null, source: Source, via: string | null, at: string | null,
 *   cost: number | null, approx: boolean,
 *   fate: "held" | "sold" | "scrapped", proceeds: number | null, goneAt: string | null, sellsHours: number | null,
 *   worn: boolean, chosen: boolean | null, chosenBy: ChosenBy | null, streak: number | null
 * }} Piece
 */
/** How the ledger charges a craft's steel: "auto" tells each craft apart, the other two force one way. @typedef {"auto" | "random" | "chosen"} SteelMode */

/**
 * A run of crafts of one tier giving the same slot this long is taken for a
 * chosen slot when the extension did not see the craft made. A random craft
 * gives a weapon 30% of the time and each armour slot 14%
 * (RANDOM_SLOT_ODDS): six weapons in a row come by chance after 0.07% of
 * random crafts (0.3^6), five of one armour slot after 0.005% (0.14^5), so
 * about half a percent of random crafts fall in such a run and are charged
 * the doubled steel; a chosen run shorter than this is charged the random fee.
 */
export const CHOSEN_STREAK = Object.freeze({ weapon: 6, armour: 5 });

/**
 * Whether each craft row chose its slot, and how that is known: the setting
 * forces one way; else the press the extension saw in the game's craft
 * window (`p`: "c" chosen, "r" random); else a streak of the tier's crafts
 * giving the same slot (CHOSEN_STREAK); else random, the game's default.
 * @param {ReadonlyArray<Row>} crafts craft rows, oldest first
 * @param {SteelMode} [steelMode]
 * @returns {Map<string, { chosen: boolean, by: ChosenBy, streak: number | null }>} by transaction id
 */
export function craftModes(crafts, steelMode = "auto") {
  /** @type {Map<string, { chosen: boolean, by: ChosenBy, streak: number | null }>} */
  const modes = new Map();
  if (steelMode !== "auto") {
    for (const r of crafts)
      modes.set(r.x, {
        chosen: steelMode === "chosen",
        by: "setting",
        streak: null,
      });
    return modes;
  }
  /** @type {Map<string, Row[]>} each tier's crafts in order: a streak is counted within its tier */
  const byTier = new Map();
  for (const r of crafts) {
    const rarity = describeCode(r.ic ?? "")?.rarity ?? "?";
    let list = byTier.get(rarity);
    if (!list) byTier.set(rarity, (list = []));
    list.push(r);
  }
  for (const list of byTier.values())
    for (let i = 0; i < list.length;) {
      let j = i;
      while (j < list.length && list[j].ic === list[i].ic) j++;
      const length = j - i;
      const slot = describeCode(list[i].ic ?? "")?.slot;
      const streak =
        length >=
        (slot === "weapon" ? CHOSEN_STREAK.weapon : CHOSEN_STREAK.armour);
      for (const r of list.slice(i, j))
        modes.set(
          r.x,
          r.p === "c" || r.p === "r"
            ? { chosen: r.p === "c", by: "seen", streak: null }
            : streak
              ? { chosen: true, by: "streak", streak: length }
              : { chosen: false, by: "default", streak: null },
        );
      i = j;
    }
  return modes;
}

/** A press of the game's CRAFT button as the worker keeps it: when (the page's clock), the tier, chosen or random, the slot read off the window. @typedef {{ n?: number, t: number, r: string, c: boolean, s?: string | null }} Pick */
/** How far from a press its craft row is looked for while the clocks' offset is measured. */
export const OFFSET_SEARCH_MS = 300_000;
/** The offset is read as the gap most presses agree on, within this width (the server's own delay varies). */
const OFFSET_WINDOW_MS = 1000;
/** The newest presses the offset is read from. */
const OFFSET_PICKS = 300;
/** How close a craft row must be to a press, once the offset is taken off, to be the press's craft. */
export const MATCH_WITHIN_MS = 20_000;
/** A press whose slot is not the craft's counts as this much further away (the slot is read off a tile, the button says chosen or random). */
const SLOT_MISMATCH_MS = 10_000;

/**
 * The first index of `list` (sorted by `key`) whose key is at least `t`.
 * @template T @param {ReadonlyArray<T>} list @param {number} t @param {(x: T) => number} key
 */
function lowerBound(list, t, key) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(list[mid]) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Ties presses of the game's CRAFT button to the craft rows they made. A
 * press carries the page's clock, a row the server's, and the two can be
 * apart by more than the time between two clicks: the offset is the gap
 * (craft time - press time, pairs of one tier within OFFSET_SEARCH_MS) that
 * the most pairs agree on within OFFSET_WINDOW_MS, the smaller one on a tie.
 * Each craft, oldest first, then takes the unmatched press of its tier
 * closest to it once the offset is taken off, within MATCH_WITHIN_MS; a
 * press that read another slot counts SLOT_MISMATCH_MS further away. A press
 * that made no craft (a failed click) is left over.
 * @param {ReadonlyArray<{ x: string, t: number, rarity: string | null | undefined, code: string }>} crafts
 * @param {ReadonlyArray<Pick>} picks
 * @returns {{ matches: Map<string, number>, offset: number | null }} craft id -> index of its press in `picks`
 */
export function matchPicks(crafts, picks) {
  /** @type {Map<string, number>} */
  const matches = new Map();
  const ordered = crafts
    .filter((c) => c.rarity && Number.isFinite(c.t))
    .sort((a, b) => a.t - b.t);
  /** @type {Map<string, number[]>} each tier's craft times, in order */
  const timesOf = new Map();
  for (const c of ordered) {
    const tier = /** @type {string} */ (c.rarity);
    let list = timesOf.get(tier);
    if (!list) timesOf.set(tier, (list = []));
    list.push(c.t);
  }
  /** @type {number[]} */
  const gaps = [];
  for (const p of picks.slice(-OFFSET_PICKS)) {
    const times = timesOf.get(p.r) ?? [];
    for (
      let k = lowerBound(times, p.t - OFFSET_SEARCH_MS, (t) => t);
      k < times.length && times[k] <= p.t + OFFSET_SEARCH_MS;
      k++
    )
      gaps.push(times[k] - p.t);
  }
  gaps.sort((a, b) => a - b);
  /** @type {number | null} */
  let offset = null;
  let most = 0;
  for (let i = 0, j = 0; i < gaps.length; i++) {
    while (j < gaps.length && gaps[j] - gaps[i] <= OFFSET_WINDOW_MS) j++;
    if (j - i < most) continue;
    // the window's median, the gaps being in order
    const mid = (i + j - 1) / 2;
    const center = (gaps[Math.floor(mid)] + gaps[Math.ceil(mid)]) / 2;
    if (j - i > most || Math.abs(center) < Math.abs(offset ?? Infinity)) {
      most = j - i;
      offset = center;
    }
  }
  if (offset == null) return { matches, offset: null };
  /** @type {Map<string, Array<{ t: number, i: number }>>} each tier's presses, in order */
  const picksOf = new Map();
  picks.forEach((p, i) => {
    if (!Number.isFinite(p.t)) return;
    let list = picksOf.get(p.r);
    if (!list) picksOf.set(p.r, (list = []));
    list.push({ t: p.t, i });
  });
  for (const list of picksOf.values()) list.sort((a, b) => a.t - b.t);
  const used = new Set();
  for (const c of ordered) {
    const list = picksOf.get(/** @type {string} */ (c.rarity)) ?? [];
    const at = c.t - offset;
    let best = -1;
    let cost = Infinity;
    for (
      let k = lowerBound(list, at - MATCH_WITHIN_MS, (x) => x.t);
      k < list.length && list[k].t <= at + MATCH_WITHIN_MS;
      k++
    ) {
      const { t, i } = list[k];
      if (used.has(i)) continue;
      const p = picks[i];
      const away =
        Math.abs(at - t) +
        (p.c && p.s && p.s !== c.code ? SLOT_MISMATCH_MS : 0);
      if (away <= MATCH_WITHIN_MS && away < cost) {
        cost = away;
        best = i;
      }
    }
    if (best >= 0) {
      used.add(best);
      matches.set(c.x, best);
    }
  }
  return { matches, offset };
}

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

/**
 * Every piece the player got, with its cost and its fate; the wooden cases'
 * resource outcomes; the player's resource trades. A fate attaches to the
 * latest acquisition of that item id before it that has none yet; a fate
 * with no acquisition on record becomes a piece of source "unknown" (its
 * proceeds still count, it has no cost). A piece scrapped for fewer scraps
 * than its tier's ladder was worn in battle (`worn`). A craft's steel is
 * doubled when its slot was chosen (`chosen`, told as craftModes says).
 * @param {ReadonlyArray<Row>} rows
 * @param {{ averages?: Averages | null, steelMode?: SteelMode }} [options]
 */
export function replayHistory(
  rows,
  { averages = {}, steelMode = "auto" } = {},
) {
  const price = makePricer(averages, rows);
  // Rows are replayed oldest first, so every piece on record was got at or before the row at hand.
  const sorted = rows
    .map((r) => ({ r, t: Date.parse(r.a) }))
    .sort((x, y) => x.t - y.t)
    .map((x) => x.r);
  const modes = craftModes(
    sorted.filter((r) => r.y === "craftItem"),
    steelMode,
  );
  /** @type {Piece[]} */
  const pieces = [];
  /** @type {Map<Piece, { t: number, stats: string }>} when each piece was got and its stats, read once */
  const keyOf = new Map();
  /** @type {Map<string, Piece[]>} */
  const byItem = new Map();
  /** @type {Map<string, Piece[]>} acquisitions by code, for fates tied by the time the piece was got */
  const byCode = new Map();
  /** @type {Array<{ at: string, code: string, q: number, value: number | null, cost: number | null, approx: boolean }>} */
  const wooden = [];
  /** @type {Record<string, { qty: number, spent: number, sold: number, earned: number }>} */
  const trades = {};
  /**
   * Tools (v0.27): what a toolbox gives an employee. Not tradable and without a market price, they stay out of
   * the pieces (and so out of every result and the picker); a dismantle of one closes it here.
   * @type {Array<{ id: string, code: string, skills: Record<string, number> | null, at: string | null, via: string | null, fate: "held" | "scrapped", proceeds: number | null, goneAt: string | null }>}
   */
  const tools = [];
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
      worn: false,
      chosen: null,
      chosenBy: null,
      streak: null,
    });
    pieces.push(piece);
    keyOf.set(piece, {
      t: Date.parse(r.a),
      stats: JSON.stringify(r.k ?? null),
    });
    byItem.set(r.i, [...(byItem.get(r.i) ?? []), piece]);
    if (source !== "unknown") {
      const list = byCode.get(r.ic) ?? [];
      list.push(piece);
      byCode.set(r.ic, list);
    }
    return piece;
  };
  /** @param {Row} r @param {"sold" | "scrapped"} kind @param {number | null} proceeds @param {boolean} [worn] */
  const fate = (r, kind, proceeds, worn = false) => {
    if (!r.i) return;
    let owned = (byItem.get(r.i) ?? [])
      .filter((p) => p.fate === "held" && p.at != null)
      .at(-1);
    const got = r.la ? Date.parse(r.la) : NaN;
    if (!owned && Number.isFinite(got) && r.ic) {
      const stats = JSON.stringify(r.k ?? null);
      let best = Infinity;
      for (const p of byCode.get(r.ic) ?? []) {
        if (p.fate !== "held" || p.at == null) continue;
        const key = keyOf.get(p);
        const gap = Math.abs((key?.t ?? NaN) - got);
        if (gap <= ACQUIRED_WITHIN_MS && gap < best && key?.stats === stats) {
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
            p.fate === "held" && p.at != null && keyOf.get(p)?.stats === stats,
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
    target.worn = worn;
  };
  for (const r of sorted) {
    const day = dayOf(r.a);
    if (r.y === "craftItem") {
      const rarity = describe(r.ic ?? "").rarity;
      const mode = modes.get(r.x) ?? {
        chosen: steelMode === "chosen",
        by: steelMode === "auto" ? "default" : "setting",
        streak: null,
      };
      const recipe = rarity
        ? craftRecipe(rarity, { chosen: mode.chosen })
        : null;
      const s = price("scraps", day);
      const t = price("steel", day);
      const scraps = recipe?.scraps ?? r.q ?? null;
      const cost =
        recipe && scraps != null && s.value != null && t.value != null
          ? scraps * s.value + recipe.steel * t.value
          : null;
      const piece = acquire(r, "crafted", cost, s.approx || t.approx, null);
      if (piece) {
        piece.chosen = mode.chosen;
        piece.chosenBy = /** @type {ChosenBy} */ (mode.by);
        piece.streak = mode.streak;
      }
    } else if (r.y === "openCase") {
      if (r.i && r.ic && (r.c === "toolbox" || isToolCode(r.ic)))
        tools.push({
          id: r.i,
          code: r.ic,
          skills: r.k ?? null,
          at: r.a,
          via: r.c ?? null,
          fate: "held",
          proceeds: null,
          goneAt: null,
        });
      else if (r.i) {
        const p = price(r.c ?? "", day);
        acquire(r, "opened", p.value, p.approx, r.c ?? null);
      } else if (r.c) {
        // a wooden case gives resources, no piece: valued at that resource's price, cost the wooden case's;
        // since v0.27 sometimes cases instead (case1, case2 at their price; a toolbox has none)
        const v = price(r.c, day);
        const c = price("woodenCase", day);
        wooden.push({
          at: r.a,
          code: r.c,
          q: r.q ?? 0,
          value: v.value == null ? null : (r.q ?? 0) * v.value,
          cost: c.value,
          approx: v.approx || c.approx,
          ...(CASE_DROP_CODES.includes(r.c) ? { drop: "case" } : {}),
        });
      }
    } else if (r.y === "battleLoot") {
      if (!isToolCode(r.ic)) acquire(r, "looted", 0, false, null);
    } else if (r.y === "dismantleItem" && isToolCode(r.ic)) {
      const s = price("scraps", day);
      const proceeds =
        s.value == null ? null : Math.round((r.q ?? 0) * s.value * 1e6) / 1e6;
      const tool = tools
        .filter((t) => t.id === r.i && t.fate === "held")
        .at(-1);
      if (tool) {
        tool.fate = "scrapped";
        tool.proceeds = proceeds;
        tool.goneAt = r.a;
      } else if (r.i && r.ic)
        tools.push({
          id: r.i,
          code: r.ic,
          skills: r.k ?? null,
          at: null,
          via: null,
          fate: "scrapped",
          proceeds,
          goneAt: r.a,
        });
    } else if (r.y === "itemMarket") {
      if (r.d === 1) acquire(r, "bought", r.m ?? null, false, null);
      else if (r.d === -1) fate(r, "sold", r.m ?? null);
    } else if (r.y === "dismantleItem") {
      const s = price("scraps", day);
      const rarity = describe(r.ic ?? "").rarity;
      const full = rarity
        ? SCRAP_LADDER[/** @type {keyof typeof SCRAP_LADDER} */ (rarity)]
        : null;
      fate(
        r,
        "scrapped",
        s.value == null ? null : (r.q ?? 0) * s.value,
        full != null && (r.q ?? 0) < full,
      );
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
  return { pieces, wooden, trades, tools };
}

/** @param {ReadonlyArray<number | null | undefined>} xs */
const sum = (xs) => xs.reduce((/** @type {number} */ s, x) => s + (x ?? 0), 0);

/**
 * The result of one set of pieces: what they cost, what came of them (sold,
 * scrapped, or held at `valueOf`), and the result where both are known.
 * "realized" counts the pieces that are gone, "estimated" adds the held
 * ones at what they sell for. Gear worn in battle is left out unless
 * `countWorn` (fighting gear is spent, not traded); `worn` says how many.
 * `chosen` counts the crafts charged the chosen slot's doubled steel.
 * @param {ReadonlyArray<Piece>} all @param {(p: Piece) => number | null} valueOf
 * @param {{ countWorn?: boolean }} [options]
 */
export function outcome(all, valueOf, { countWorn = true } = {}) {
  const worn = all.filter((p) => p.worn).length;
  const pieces = countWorn ? all : all.filter((p) => !p.worn);
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
    worn,
    chosen: pieces.filter((p) => p.chosen === true).length,
  };
}

/**
 * The window's view by activity: the pieces got in it (crafted, opened,
 * bought, looted), each set's outcome, per case and per crafted tier; what
 * was sold or scrapped in it whatever its age (the window's money); the
 * wooden cases opened in it. Gear worn in battle counts only with
 * `countWorn`.
 * @param {ReturnType<typeof replayHistory>} history
 * @param {{ from: string, to: string, dayOf?: (iso: string | null) => string, valueOf: (p: Piece) => number | null, countWorn?: boolean }} input
 */
export function windowView(
  history,
  { from, to, dayOf: day = localDayOf, valueOf, countWorn = true },
) {
  const inWindow = (/** @type {string | null} */ iso) => {
    const d = iso ? day(iso) : "";
    return d >= from && d <= to;
  };
  const got = history.pieces.filter((p) => inWindow(p.at));
  /** @param {ReadonlyArray<Piece>} set */
  const result = (set) => outcome(set, valueOf, { countWorn });
  /** @param {Source} s */
  const of = (s) => result(got.filter((p) => p.source === s));
  const goneAll = history.pieces.filter(
    (p) => p.fate !== "held" && inWindow(p.goneAt),
  );
  const gone = countWorn ? goneAll : goneAll.filter((p) => !p.worn);
  const goneKnown = gone.filter((p) => p.cost != null && p.proceeds != null);
  // a wooden case is counted where what it gave has a price; one that dropped toolboxes (no market price) or
  // a drop without that day's price yet apart
  const woodenAll = history.wooden.filter((w) => inWindow(w.at));
  const wooden = woodenAll.filter((w) => w.value != null);
  const tools = history.tools ?? [];
  const toolsGone = tools.filter(
    (t) => t.fate === "scrapped" && inWindow(t.goneAt),
  );
  /** @type {Record<string, ReturnType<typeof outcome>>} */
  const cases = {};
  for (const code of new Set(
    got.filter((p) => p.source === "opened").map((p) => p.via ?? "?"),
  ))
    cases[code] = result(
      got.filter((p) => p.source === "opened" && (p.via ?? "?") === code),
    );
  /** @type {Record<string, ReturnType<typeof outcome>>} */
  const tiers = {};
  for (const r of new Set(
    got.filter((p) => p.source === "crafted").map((p) => p.rarity ?? "?"),
  ))
    tiers[r] = result(
      got.filter((p) => p.source === "crafted" && (p.rarity ?? "?") === r),
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
    woodenUnpriced: woodenAll.length - wooden.length,
    woodenToolboxes: woodenAll.filter(
      (w) => w.value == null && w.code === "toolbox",
    ).length,
    tools: {
      n: tools.filter((t) => inWindow(t.at)).length,
      scrapped: toolsGone.length,
      proceeds: sum(toolsGone.map((t) => t.proceeds)),
    },
    money: {
      n: gone.length,
      sold: gone.filter((p) => p.fate === "sold").length,
      scrapped: gone.filter((p) => p.fate === "scrapped").length,
      proceeds: sum(gone.map((p) => p.proceeds)),
      realized: sum(goneKnown.map((p) => (p.proceeds ?? 0) - (p.cost ?? 0))),
      known: goneKnown.length,
      unknownCost: gone.filter((p) => p.cost == null).length,
      worn: goneAll.filter((p) => p.worn).length,
    },
  };
}

/**
 * A day function that reads each time once, for the several windows a view
 * computes over the same pieces.
 * @param {(iso: string) => string} [day]
 */
export function memoDay(day = localDayOf) {
  /** @type {Map<string, string>} */
  const seen = new Map();
  return (/** @type {string | null} */ iso) => {
    if (!iso) return "";
    let d = seen.get(iso);
    if (d === undefined) {
      d = day(iso);
      seen.set(iso, d);
    }
    return d;
  };
}
