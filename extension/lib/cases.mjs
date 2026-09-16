// Case models for WarEra Lens: what a case is worth opened,
// what the market bids for it sealed, and what a trip to a wooden case on the
// map costs. Pure functions plus explicit immutable-snapshot memoization;
// the extension and tests use the same code.
//
// Valuation rule (editor, 2026-09-03, kept in src/woodcase/sim.mjs): contents
// are worth what they fetch SOLD AT ONCE, the best bid, compared as is with the
// sealed case's best bid; oil is priced at the best ask because the traveller
// has to buy it. No tax on either leg.

// ---------------------------------------------------------- the wooden case -
// Patch notes v0.26.0 (article 6aa97af2c0e0960dfc3ca750) and the codex entry
// "Wooden cases on the map": a rarity tier is rolled (65/20/13/2), then one
// resource of that tier uniformly, then a budget of 20..80 production points
// is spent on it: units = floor(budget / productionPoints), never below one.
// The notes' seven amount bands come out of floor and of round alike, so the
// round rule is carried as the upper edge of a band.
import { RARITIES, GEAR_CODES } from "./items.mjs";
import { positive, quote } from "./quality.mjs";
import { SCRAP_LADDER } from "./ladder.mjs";
export { GEAR_CODES, ALL_GEAR_CODES } from "./items.mjs";

export const WOODEN_TIERS = [
  { tier: "epic", pct: 2, items: ["cookedFish", "heavyAmmo", "cocain"] },
  { tier: "rare", pct: 13, items: ["ammo", "steak"] },
  {
    tier: "uncommon",
    pct: 20,
    items: ["concrete", "steel", "bread", "oil", "paper", "lightAmmo"],
  },
  {
    tier: "common",
    pct: 65,
    items: [
      "grain",
      "iron",
      "wood",
      "lead",
      "limestone",
      "coca",
      "petroleum",
      "livestock",
      "fish",
    ],
  },
];
/** productionPoints per unit, gameConfig.getGameConfig items[] (pinned 2026-09-16). */
export const WOODEN_PP = {
  cookedFish: 40,
  heavyAmmo: 16,
  cocain: 200,
  ammo: 4,
  steak: 20,
  concrete: 10,
  steel: 10,
  bread: 10,
  oil: 1,
  paper: 1,
  lightAmmo: 1,
  grain: 1,
  iron: 1,
  wood: 1,
  lead: 1,
  limestone: 1,
  coca: 1,
  petroleum: 1,
  livestock: 20,
  fish: 40,
};
export const WOODEN_BUDGET = { min: 20, max: 80 };
export const RESOURCE_NAMES = {
  cookedFish: "Cooked Fish",
  heavyAmmo: "Heavy Ammo",
  cocain: "Pill",
  ammo: "Ammo",
  steak: "Steak",
  concrete: "Concrete",
  steel: "Steel",
  bread: "Bread",
  oil: "Oil",
  paper: "Paper",
  lightAmmo: "Light Ammo",
  grain: "Grain",
  iron: "Iron",
  wood: "Wood",
  lead: "Lead",
  limestone: "Limestone",
  coca: "Mysterious Plant",
  petroleum: "Petroleum",
  livestock: "Livestock",
  fish: "Fish",
};
export const WOODEN_CODES = WOODEN_TIERS.flatMap((t) => t.items);

/** Expected units of a resource per case: the budget, uniform over 20..80, divided by its production points. */
const quantityCache = new Map();
export function expectedQty(pp, rule = "floor") {
  if (positive(pp) == null || !["floor", "round"].includes(rule))
    throw new RangeError("Invalid production model");
  const key = `${pp}:${rule}`;
  if (quantityCache.has(key)) return quantityCache.get(key);
  const f = rule === "round" ? Math.round : Math.floor;
  let sum = 0;
  let n = 0;
  for (let b = WOODEN_BUDGET.min; b <= WOODEN_BUDGET.max; b++) {
    sum += Math.max(1, f(b / pp));
    n++;
  }
  quantityCache.set(key, sum / n);
  return sum / n;
}

/**
 * What a wooden case opens for, with `priceOf(code)` the gold a unit fetches
 * (the best bid). { ev, evRound, rows, tiers, complete, missing }; a resource
 * without a price counts zero and is named in `missing`.
 */
export function woodenCaseValue(priceOf, rule = "floor", quoteOf = null) {
  const rows = [];
  const missing = [];
  for (const t of WOODEN_TIERS) {
    for (const code of t.items) {
      const price = priceOf(code);
      let ok = positive(price) != null;
      const eQty = expectedQty(WOODEN_PP[code], rule);
      let gold = ok ? eQty * Number(price) : 0;
      if (quoteOf) {
        let total = 0;
        for (
          let budget = WOODEN_BUDGET.min;
          budget <= WOODEN_BUDGET.max;
          budget++
        ) {
          const units = Math.max(1, Math[rule](budget / WOODEN_PP[code]));
          const q = quoteOf(code, units);
          if (!q.complete) ok = false;
          total += q.value ?? 0;
        }
        gold = total / (WOODEN_BUDGET.max - WOODEN_BUDGET.min + 1);
      }
      if (!ok) missing.push(code);
      rows.push({
        code,
        name: RESOURCE_NAMES[code],
        tier: t.tier,
        tierPct: t.pct,
        itemPct: t.pct / t.items.length,
        pp: WOODEN_PP[code],
        eQty,
        bid: positive(price),
        gold,
      });
    }
  }
  const tiers = WOODEN_TIERS.map((t) => {
    const rs = rows.filter((r) => r.tier === t.tier);
    const meanGold = rs.reduce((s, r) => s + r.gold, 0) / rs.length;
    return {
      tier: t.tier,
      pct: t.pct,
      meanGold,
      contribution: (t.pct / 100) * meanGold,
    };
  });
  const ev = tiers.reduce((s, t) => s + t.contribution, 0);
  const round =
    rule === "round" ? null : woodenCaseValue(priceOf, "round", quoteOf);
  const evRound = round?.ev ?? ev;
  return {
    ev,
    evRound,
    rows,
    tiers,
    complete: missing.length === 0 && (round?.complete ?? true),
    missing: [...new Set([...missing, ...(round?.missing ?? [])])],
  };
}

// --------------------------------------------------------- the battle cases -
// data/lootbox/case-odds-empirical.json (2026-09-01): 543,747 real opens of
// the normal case and 18,692 of the elite case from the global feed. The
// normal case matches the codex table (chi2 p=0.62); the elite case runs LOW
// (67.5 scraps against 70 advertised), so the empirical figures are the ones.
export const CASE_ODDS = {
  case1: {
    label: "Case",
    scrapsPerCase: 14.7188,
    weaponShare: 0.30015,
    rarity: {
      common: 0.619237,
      uncommon: 0.300342,
      rare: 0.071349,
      epic: 0.008533,
      legendary: 0.000436,
      mythic: 0.000103,
    },
  },
  case2: {
    label: "Elite Case",
    scrapsPerCase: 67.499,
    weaponShare: 0.3073,
    rarity: {
      common: 0,
      uncommon: 0.503745,
      rare: 0.324203,
      epic: 0.143002,
      legendary: 0.025305,
      mythic: 0.003745,
    },
  },
};
export const CASE_LABELS = {
  woodenCase: "Wooden Case",
  case1: "Case",
  case2: "Elite Case",
};
export const CASE_CODES = ["woodenCase", "case1", "case2"];

const num = (v) =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);

/** An open cashed by dismantling: scraps per case (audited) x the scrap price; null for the wooden case. */
export function caseScrapValue(caseCode, scrapBid) {
  const odds = CASE_ODDS[caseCode];
  const p = num(scrapBid);
  return odds && p != null ? odds.scrapsPerCase * p : null;
}

/** Outcome-weighted proceeds, walking the depth separately for each possible drop. */
export function caseScrapQuote(caseCode, bids) {
  const odds = CASE_ODDS[caseCode];
  if (!odds) return { value: null, complete: false };
  let value = 0;
  for (const rarity of RARITIES) {
    if (!odds.rarity[rarity]) continue;
    const q = quote(SCRAP_LADDER[rarity], bids);
    if (!q.complete) return { value: null, complete: false };
    value += odds.rarity[rarity] * q.value;
  }
  return { value, complete: true };
}

/**
 * An open cashed on the equipment market at the average item price the game
 * prints as "Current value" (`avgOf(code)`): rarity odds x (weapon share x the
 * weapon's average + the rest x the mean of the five armour pieces). A rarity
 * with no priced code at all makes the value incomplete.
 */
export function caseMarketValue(caseCode, avgOf) {
  const odds = CASE_ODDS[caseCode];
  if (!odds) return { value: null, complete: false, missing: [] };
  let value = 0;
  const missing = [];
  let coverage = 0;
  for (const r of RARITIES) {
    const p = odds.rarity[r];
    if (!p) continue;
    const g = GEAR_CODES[r];
    // zero is the game's "no sales yet", not a price: it never enters a mean
    const priced = (c) => {
      const v = num(avgOf(c));
      return v != null && v > 0 ? v : null;
    };
    const weapon = priced(g.weapon);
    for (const [code, weight] of [
      [g.weapon, odds.weaponShare],
      ...g.gear.map((c) => [c, (1 - odds.weaponShare) / g.gear.length]),
    ]) {
      const price = code === g.weapon ? weapon : priced(code);
      if (price == null) {
        missing.push(code);
        continue;
      }
      value += p * weight * price;
      coverage += p * weight;
    }
  }
  return {
    value: coverage ? value : null,
    complete: missing.length === 0,
    missing,
    coverage,
  };
}

// ---------------------------------------------------------------- verdicts -
/** Selling sealed has to clear the open value by this much before it is called; the same margin the other way calls an open. */
export const SELL_MARGIN = 1.1;

/** { verdict: 'sell' | 'open' | 'even' | null, ratio: bid / openValue }. */
export function caseVerdict({
  bid,
  openValue,
  margin = SELL_MARGIN,
  complete = true,
  band = null,
}) {
  const b = num(bid);
  const o = num(openValue);
  if (b == null || o == null || !(o > 0) || !(b > 0) || !complete)
    return { verdict: null, ratio: null };
  const ratio = b / o;
  const [low, high] = band ?? [o, o];
  return {
    verdict: b >= high * margin ? "sell" : low >= b * margin ? "open" : "even",
    ratio,
  };
}

// ------------------------------------------------------------------ travel -
// v0.26 client (module 45429): a trip of N regions costs 10N stamina when the
// bar covers all of it, otherwise 2N oil for all of it; never both.
export const STAMINA_PER_HOP = 10;
export const OIL_PER_HOP = 2;

/** The cost of walking `hops` regions to a case worth `value`, oil at `oilAsk`. */
export function tripCost({ hops, oilAsk, value }) {
  const h = Number(hops);
  if (
    hops == null ||
    hops === "" ||
    typeof hops === "boolean" ||
    !Number.isSafeInteger(h) ||
    h < 0
  )
    throw new RangeError("Distance must be a non-negative integer");
  const oil = h * OIL_PER_HOP;
  const price = num(oilAsk);
  const v = num(value);
  const oilGold = h === 0 ? 0 : price == null ? null : oil * price;
  const netOneWay = v == null || oilGold == null ? null : v - oilGold;
  const netRoundTrip = v == null || oilGold == null ? null : v - 2 * oilGold;
  return {
    hops: h,
    stamina: h * STAMINA_PER_HOP,
    oil,
    oilGold,
    netOneWay,
    netRoundTrip,
    breakevenHops:
      v == null || price == null || !(price > 0)
        ? null
        : v / (OIL_PER_HOP * price),
    paysOneWay: netOneWay == null ? null : netOneWay > 0,
    paysRoundTrip: netRoundTrip == null ? null : netRoundTrip > 0,
  };
}

/** "7 regions away" / "1 region away" -> 7 / 1 (lingui id sX+lDG, the same text in every catalog read); null for the km fallback. */
export function regionsAwayFromText(text) {
  const m = /(\d+)\s*regions?\s+away/i.exec(String(text ?? ""));
  return m ? Number(m[1]) : null;
}

// ------------------------------------------------------------ drop policy -
// The editor's rule (2026-09-16): cheap drops are dismantled, expensive ones
// are sold. `sellFrom` names the first rarity that is sold at the game's
// average item price; everything below it is valued at the scrap quote.
// "never" scraps all, "common" sells all.
export const SELL_FROM = [
  "never",
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "mythic",
];

/** Does the policy sell a drop of this rarity (true) or scrap it (false)? */
export function sellsRarity(sellFrom, rarity) {
  const i = SELL_FROM.indexOf(sellFrom);
  const r = RARITIES.indexOf(rarity);
  return i > 0 && r >= 0 && r >= i - 1;
}

/** "scrap ≤ rare · sell ≥ epic at avg", "sell all drops at avg", "scrap-only EV". */
export function policyLabel(sellFrom) {
  const i = SELL_FROM.indexOf(sellFrom);
  if (i <= 0) return "scrap-only EV";
  if (i === 1) return "sell all drops at avg";
  return `scrap ≤ ${RARITIES[i - 2]} · sell ≥ ${sellFrom} at avg`;
}

/**
 * One rarity's drop sold at the game's average item price: the weapon at its
 * share, the five armour pieces at the rest, renormalised over the codes that
 * carry a price. { unit, priced, total }; unit null when nothing is priced.
 */
export function rarityResaleValue(rarity, odds, avgOf) {
  const g = GEAR_CODES[rarity];
  const weights = [
    [g.weapon, odds.weaponShare],
    ...g.gear.map((c) => [c, (1 - odds.weaponShare) / g.gear.length]),
  ];
  let sum = 0;
  let cover = 0;
  let priced = 0;
  for (const [code, weight] of weights) {
    const v = num(avgOf(code));
    if (v == null || !(v > 0)) continue;
    sum += weight * v;
    cover += weight;
    priced++;
  }
  return { unit: cover ? sum / cover : null, priced, total: weights.length };
}

/**
 * What an open is worth under the drop policy: for each rarity the audited
 * odds x (the scrap quote walked through the scrap book, or the resale value
 * when the policy sells that rarity and a price exists). A rarity the policy
 * would sell but that has no average price falls back to its scrap quote and
 * is flagged, never imputed. { value, complete, selling, rows }.
 */
export function casePolicyValue(caseCode, { bids, avgOf, sellFrom = "never" }) {
  const odds = CASE_ODDS[caseCode];
  if (!odds) return { value: null, complete: false, selling: false, rows: [] };
  const rows = [];
  let value = 0;
  let complete = true;
  let selling = false;
  for (const rarity of RARITIES) {
    const p = odds.rarity[rarity];
    if (!p) continue;
    const scrap = quote(SCRAP_LADDER[rarity], bids);
    let mode = sellsRarity(sellFrom, rarity) ? "sell" : "scrap";
    let fallback = false;
    let unit = null;
    let priced = null;
    if (mode === "sell") {
      const r = rarityResaleValue(rarity, odds, avgOf ?? (() => null));
      priced = `${r.priced}/${r.total}`;
      if (r.unit == null) {
        mode = "scrap";
        fallback = true;
      } else {
        unit = r.unit;
        selling = true;
      }
    }
    if (mode === "scrap") {
      unit = scrap.value;
      if (!scrap.complete) complete = false;
    }
    rows.push({
      rarity,
      p,
      mode,
      fallback,
      priced,
      unit,
      contribution: unit == null ? null : p * unit,
    });
    if (unit != null) value += p * unit;
  }
  return { value: complete ? value : null, complete, selling, rows };
}

// ----------------------------------------------------------------- summary -
const summaryCache = new WeakMap();
/** UI-only memoization: API snapshots are immutable. Freshness-filtered averages
 * and the drop policy participate in the key, so an expired/failed item or a
 * changed policy cannot retain its valuation.
 */
export function snapshotSummary({ books, avg = null, sellFrom = "never" }) {
  if (!books) return casesSummary({ books, avg, sellFrom });
  const key = `${sellFrom}:${JSON.stringify(avg)}`;
  const old = summaryCache.get(books);
  if (old?.key === key) return old.value;
  const value = casesSummary({ books, avg, sellFrom });
  summaryCache.set(books, { key, value });
  return value;
}

/**
 * One row per case for the strip: { code, label, bid, bidQty, ask, askQty,
 * openScrap, openMarket, openValue, openBand, complete, ratio, verdict }, plus the
 * oil ask and the scrap bid. `books[code] = { bid, ask, bidQty, askQty }`,
 * `avg[code] = number` (may be null when the averages were not read).
 */
export function casesSummary({ books, avg, sellFrom = "never" }) {
  const b = books ?? {};
  const bidOf = (c) => num(b[c]?.bid);
  const avgOf = (c) => (avg ? num(avg[c]) : null);
  const scrapBid = bidOf("scraps");
  const wooden = woodenCaseValue(bidOf, "floor", (code, units) =>
    quote(units, b[code]?.bids),
  );
  const rows = CASE_CODES.map((code) => {
    const book = b[code] ?? {};
    let openScrap = null;
    let openMarket = null;
    let openValue = null;
    let openBand = null;
    let complete = true;
    let coverage = null;
    let basis = "resource EV";
    let policy = null;
    if (code === "woodenCase") {
      openValue = wooden.ev;
      openBand = [wooden.ev, wooden.evRound];
      complete = wooden.complete;
    } else {
      const scrapQuote = caseScrapQuote(code, b.scraps?.bids);
      openScrap = scrapQuote.value;
      const m = avg
        ? caseMarketValue(code, avgOf)
        : { value: null, complete: false };
      openMarket = m.value;
      coverage = m.coverage ?? 0;
      // The drop policy decides what an open is worth: scrap the cheap rarities
      // (an instant quote through the scrap book), sell the expensive ones at
      // the game's average item price. With no policy, or no average prices
      // yet, the scrap-only quote stands.
      policy = casePolicyValue(code, { bids: b.scraps?.bids, avgOf, sellFrom });
      openBand = null;
      if (policy.selling) {
        openValue = policy.value;
        complete = policy.complete;
        basis = policyLabel(sellFrom);
      } else {
        openValue = openScrap;
        complete = scrapQuote.complete;
        basis =
          sellFrom !== "never" && SELL_FROM.includes(sellFrom)
            ? "scrap-only EV (no average prices yet)"
            : "scrap-only EV";
      }
    }
    const sealed = quote(1, book.bids);
    complete = complete && sealed.complete;
    const v = caseVerdict({
      bid: num(book.bid),
      openValue,
      band: openBand,
      complete,
    });
    return {
      code,
      label: CASE_LABELS[code],
      bid: num(book.bid),
      bidQty: num(book.bidQty) ?? 0,
      ask: num(book.ask),
      askQty: num(book.askQty) ?? 0,
      openScrap,
      openMarket,
      openValue,
      openBand,
      complete,
      coverage,
      basis,
      policy,
      ratio: v.ratio,
      verdict: v.verdict,
    };
  });
  return {
    rows,
    oilAsk: num(b.oil?.ask),
    oilBid: num(b.oil?.bid),
    scrapBid,
    wooden,
  };
}
