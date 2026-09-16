// Case maths for the Scrap Sniper extension: what a case is worth opened,
// what the market bids for it sealed, and what a trip to a wooden case on the
// map costs. Pure and import-free, so the extension loads it straight into
// the page and vitest covers the same code.
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
export const WOODEN_TIERS = [
  { tier: 'epic', pct: 2, items: ['cookedFish', 'heavyAmmo', 'cocain'] },
  { tier: 'rare', pct: 13, items: ['ammo', 'steak'] },
  { tier: 'uncommon', pct: 20, items: ['concrete', 'steel', 'bread', 'oil', 'paper', 'lightAmmo'] },
  { tier: 'common', pct: 65, items: ['grain', 'iron', 'wood', 'lead', 'limestone', 'coca', 'petroleum', 'livestock', 'fish'] },
];
/** productionPoints per unit, gameConfig.getGameConfig items[] (pinned 2026-09-16). */
export const WOODEN_PP = {
  cookedFish: 40, heavyAmmo: 16, cocain: 200, ammo: 4, steak: 20,
  concrete: 10, steel: 10, bread: 10, oil: 1, paper: 1, lightAmmo: 1,
  grain: 1, iron: 1, wood: 1, lead: 1, limestone: 1, coca: 1, petroleum: 1, livestock: 20, fish: 40,
};
export const WOODEN_BUDGET = { min: 20, max: 80 };
export const RESOURCE_NAMES = {
  cookedFish: 'Cooked Fish', heavyAmmo: 'Heavy Ammo', cocain: 'Pill', ammo: 'Ammo', steak: 'Steak',
  concrete: 'Concrete', steel: 'Steel', bread: 'Bread', oil: 'Oil', paper: 'Paper', lightAmmo: 'Light Ammo',
  grain: 'Grain', iron: 'Iron', wood: 'Wood', lead: 'Lead', limestone: 'Limestone', coca: 'Mysterious Plant',
  petroleum: 'Petroleum', livestock: 'Livestock', fish: 'Fish',
};
export const WOODEN_CODES = WOODEN_TIERS.flatMap((t) => t.items);

/** Expected units of a resource per case: the budget, uniform over 20..80, divided by its production points. */
export function expectedQty(pp, rule = 'floor') {
  const f = rule === 'round' ? Math.round : Math.floor;
  let sum = 0;
  let n = 0;
  for (let b = WOODEN_BUDGET.min; b <= WOODEN_BUDGET.max; b++) { sum += Math.max(1, f(b / pp)); n++; }
  return sum / n;
}

/**
 * What a wooden case opens for, with `priceOf(code)` the gold a unit fetches
 * (the best bid). { ev, evRound, rows, tiers, complete, missing }; a resource
 * without a price counts zero and is named in `missing`.
 */
export function woodenCaseValue(priceOf, rule = 'floor') {
  const rows = [];
  const missing = [];
  for (const t of WOODEN_TIERS) {
    for (const code of t.items) {
      const price = priceOf(code);
      const ok = Number.isFinite(Number(price)) && price != null;
      if (!ok) missing.push(code);
      const eQty = expectedQty(WOODEN_PP[code], rule);
      rows.push({ code, name: RESOURCE_NAMES[code], tier: t.tier, tierPct: t.pct, itemPct: t.pct / t.items.length, pp: WOODEN_PP[code], eQty, bid: ok ? Number(price) : null, gold: ok ? eQty * Number(price) : 0 });
    }
  }
  const tiers = WOODEN_TIERS.map((t) => {
    const rs = rows.filter((r) => r.tier === t.tier);
    const meanGold = rs.reduce((s, r) => s + r.gold, 0) / rs.length;
    return { tier: t.tier, pct: t.pct, meanGold, contribution: (t.pct / 100) * meanGold };
  });
  const ev = tiers.reduce((s, t) => s + t.contribution, 0);
  const evRound = rule === 'round' ? ev : woodenCaseValue(priceOf, 'round').ev;
  return { ev, evRound, rows, tiers, complete: missing.length === 0, missing };
}

// --------------------------------------------------------- the battle cases -
// data/lootbox/case-odds-empirical.json (2026-09-01): 543,747 real opens of
// the normal case and 18,692 of the elite case from the global feed. The
// normal case matches the codex table (chi2 p=0.62); the elite case runs LOW
// (67.5 scraps against 70 advertised), so the empirical figures are the ones.
export const CASE_ODDS = {
  case1: {
    label: 'Case', scrapsPerCase: 14.7188, weaponShare: 0.30015,
    rarity: { common: 0.619237, uncommon: 0.300342, rare: 0.071349, epic: 0.008533, legendary: 0.000436, mythic: 0.000103 },
  },
  case2: {
    label: 'Elite Case', scrapsPerCase: 67.499, weaponShare: 0.3073,
    rarity: { common: 0, uncommon: 0.503745, rare: 0.324203, epic: 0.143002, legendary: 0.025305, mythic: 0.003745 },
  },
};
export const CASE_LABELS = { woodenCase: 'Wooden Case', case1: 'Case', case2: 'Elite Case' };
export const CASE_CODES = ['woodenCase', 'case1', 'case2'];

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const WEAPONS = ['knife', 'gun', 'rifle', 'sniper', 'tank', 'jet'];
const SLOTS = ['helmet', 'chest', 'gloves', 'pants', 'boots'];
/** The 36 gear codes a battle case can drop, by rarity: one weapon and five armour pieces each. */
export const GEAR_CODES = Object.fromEntries(RARITIES.map((r, i) => [r, { weapon: WEAPONS[i], gear: SLOTS.map((s) => `${s}${i + 1}`) }]));
export const ALL_GEAR_CODES = RARITIES.flatMap((r) => [GEAR_CODES[r].weapon, ...GEAR_CODES[r].gear]);

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** An open cashed by dismantling: scraps per case (audited) x the scrap price; null for the wooden case. */
export function caseScrapValue(caseCode, scrapBid) {
  const odds = CASE_ODDS[caseCode];
  const p = num(scrapBid);
  return odds && p != null ? odds.scrapsPerCase * p : null;
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
  for (const r of RARITIES) {
    const p = odds.rarity[r];
    if (!p) continue;
    const g = GEAR_CODES[r];
    // zero is the game's "no sales yet", not a price: it never enters a mean
    const priced = (c) => { const v = num(avgOf(c)); return v != null && v > 0 ? v : null; };
    const weapon = priced(g.weapon);
    const gear = g.gear.map(priced).filter((v) => v != null);
    const gearMean = gear.length ? gear.reduce((s, v) => s + v, 0) / gear.length : null;
    if (weapon == null && gearMean == null) { missing.push(r); continue; }
    // a side with no price takes the other side's number, so a thin rarity still counts
    const w = weapon ?? gearMean;
    const a = gearMean ?? weapon;
    value += p * (odds.weaponShare * w + (1 - odds.weaponShare) * a);
  }
  return { value: missing.length === RARITIES.filter((r) => odds.rarity[r]).length ? null : value, complete: missing.length === 0, missing };
}

// ---------------------------------------------------------------- verdicts -
/** Selling sealed has to clear the open value by this much before it is called; the same margin the other way calls an open. */
export const SELL_MARGIN = 1.1;

/** { verdict: 'sell' | 'open' | 'even' | null, ratio: bid / openValue }. */
export function caseVerdict({ bid, openValue, margin = SELL_MARGIN }) {
  const b = num(bid);
  const o = num(openValue);
  if (b == null || o == null || !(o > 0) || !(b > 0)) return { verdict: null, ratio: null };
  const ratio = b / o;
  return { verdict: ratio >= margin ? 'sell' : ratio <= 1 / margin ? 'open' : 'even', ratio };
}

// ------------------------------------------------------------------ travel -
// v0.26 client (module 45429): a trip of N regions costs 10N stamina when the
// bar covers all of it, otherwise 2N oil for all of it; never both.
export const STAMINA_PER_HOP = 10;
export const OIL_PER_HOP = 2;

/** The cost of walking `hops` regions to a case worth `value`, oil at `oilAsk`. */
export function tripCost({ hops, oilAsk, value }) {
  const h = Math.max(0, Math.round(Number(hops) || 0));
  const oil = h * OIL_PER_HOP;
  const price = num(oilAsk);
  const v = num(value);
  const oilGold = price == null ? null : oil * price;
  const netOneWay = v == null || oilGold == null ? null : v - oilGold;
  const netRoundTrip = v == null || oilGold == null ? null : v - 2 * oilGold;
  return {
    hops: h, stamina: h * STAMINA_PER_HOP, oil, oilGold, netOneWay, netRoundTrip,
    breakevenHops: v == null || price == null || !(price > 0) ? null : v / (OIL_PER_HOP * price),
    paysOneWay: netOneWay == null ? null : netOneWay > 0,
    paysRoundTrip: netRoundTrip == null ? null : netRoundTrip > 0,
  };
}

/** "7 regions away" / "1 region away" -> 7 / 1 (lingui id sX+lDG, the same text in every catalog read); null for the km fallback. */
export function regionsAwayFromText(text) {
  const m = /(\d+)\s*regions?\s+away/i.exec(String(text ?? ''));
  return m ? Number(m[1]) : null;
}

// ----------------------------------------------------------------- summary -
/**
 * One row per case for the strip: { code, label, bid, bidQty, ask, askQty,
 * openScrap, openMarket, openValue, openBand, complete, ratio, verdict }, plus the
 * oil ask and the scrap bid. `books[code] = { bid, ask, bidQty, askQty }`,
 * `avg[code] = number` (may be null when the averages were not read).
 */
export function casesSummary({ books, avg }) {
  const b = books ?? {};
  const bidOf = (c) => num(b[c]?.bid);
  const avgOf = (c) => (avg ? num(avg[c]) : null);
  const scrapBid = bidOf('scraps');
  const wooden = woodenCaseValue(bidOf);
  const rows = CASE_CODES.map((code) => {
    const book = b[code] ?? {};
    let openScrap = null;
    let openMarket = null;
    let openValue = null;
    let openBand = null;
    let complete = true;
    if (code === 'woodenCase') {
      openValue = wooden.ev;
      openBand = [wooden.ev, wooden.evRound];
      complete = wooden.complete;
    } else {
      openScrap = caseScrapValue(code, scrapBid);
      const m = avg ? caseMarketValue(code, avgOf) : { value: null, complete: false };
      openMarket = m.value;
      complete = openScrap != null && (avg ? m.complete : true);
      openValue = openScrap == null && openMarket == null ? null : Math.max(openScrap ?? -Infinity, openMarket ?? -Infinity);
    }
    const v = caseVerdict({ bid: num(book.bid), openValue });
    return {
      code, label: CASE_LABELS[code],
      bid: num(book.bid), bidQty: num(book.bidQty) ?? 0, ask: num(book.ask), askQty: num(book.askQty) ?? 0,
      openScrap, openMarket, openValue, openBand, complete, ratio: v.ratio, verdict: v.verdict,
    };
  });
  return { rows, oilAsk: num(b.oil?.ask), oilBid: num(b.oil?.bid), scrapBid, wooden };
}
