// Page-reading helpers for the Scrap Sniper extension. Import-free on purpose:
// this file is pasted verbatim into the game page for live checks, and unit
// tested under vitest for everything that does not need a DOM.
//
// What the equipment market page looks like (app.warera.io/market/equipments,
// read 2026-09-03): a grid of "current value" tiles per slot and rarity, then a
// list of offers, 12 per page behind a LOAD MORE button. Every offer row holds
// the item image inside a tile whose BORDER colour is the only rarity signal
// (class names are hashed, image alts are skin names like "winterJet"), then
// stats, durability, seller, age, the taxed price and a BUY button. Clicking a
// grid tile filters the list to one item code and puts ?item=<code> in the URL.

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

/** Tile border colours per rarity, sampled live with getComputedStyle. */
export const RARITY_BORDERS = {
  mythic: [150, 38, 40],
  legendary: [129, 120, 45],
  epic: [94, 59, 145],
  rare: [37, 78, 167],
  uncommon: [43, 110, 68],
  common: [80, 112, 124],
};
const BORDER_TOLERANCE = 40; // euclidean RGB distance; the nearest off-palette colour seen is 130+ away

const WEAPON_RARITY = { knife: 'common', gun: 'uncommon', rifle: 'rare', sniper: 'epic', tank: 'legendary', jet: 'mythic' };

const parseRgb = (s) => {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(String(s ?? ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

/** Rarity from a tile's computed border colour, or null when it is off-palette. */
export function rarityFromBorder(color) {
  const rgb = parseRgb(color);
  if (!rgb) return null;
  let best = null;
  let bestD = Infinity;
  for (const [rarity, ref] of Object.entries(RARITY_BORDERS)) {
    const d = Math.hypot(rgb[0] - ref[0], rgb[1] - ref[1], rgb[2] - ref[2]);
    if (d < bestD) { bestD = d; best = rarity; }
  }
  return bestD <= BORDER_TOLERANCE ? best : null;
}

/** Rarity from an item code (gameConfig.getGameConfig, 2026-09-03): gear carries its tier digit, weapons are named. */
export function rarityFromItemCode(code) {
  const c = String(code ?? '');
  const gear = /^(helmet|chest|boots|gloves|pants)([1-6])$/.exec(c);
  if (gear) return RARITIES[Number(gear[2]) - 1];
  return WEAPON_RARITY[c] ?? null;
}

const SLOT_RE = /(helmet|chest|gloves|pants|boots|jet|tank|sniper|rifle|gun|knife)$/i;

/** The slot off a skin name: "dieselBoots" -> boots, "winterJet" -> jet; null for avatars, flags, junk. */
export function slotFromAlt(alt) {
  const a = String(alt ?? '').trim();
  if (!isItemImageAlt(a)) return null;
  const m = SLOT_RE.exec(a);
  return m ? m[1].toLowerCase() : null;
}

/** A market item code -> { slot, rarity } (boots5 -> legendary boots, jet -> mythic jet); null for non-gear. */
export function targetFromCode(code) {
  const rarity = rarityFromItemCode(code);
  if (!rarity) return null;
  const c = String(code);
  const gear = /^(helmet|chest|boots|gloves|pants)[1-6]$/.exec(c);
  return { slot: gear ? gear[1] : c, rarity };
}

/** "boots5" -> "legendary boots", "jet" -> "mythic jet"; unknown codes pass through. */
export function itemLabel(code) {
  const t = targetFromCode(code);
  return t ? `${t.rarity} ${t.slot}` : String(code ?? '');
}

/** "392.991", "1,234.5", "1.858K" -> number; anything else -> null. */
export function parsePrice(text) {
  const m = /^\s*([\d,]+(?:\.\d+)?)\s*([KkMm])?\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const mult = m[2] ? ({ k: 1e3, m: 1e6 })[m[2].toLowerCase()] : 1;
  return n * mult;
}

/** Item images carry a skin name; avatars and flags are the other images in a row. */
export function isItemImageAlt(alt) {
  const a = String(alt ?? '').trim();
  return a.length > 0 && !/avatar$/i.test(a) && !/flag$/i.test(a);
}

/** From a row's innerText lines, the price is the numeric line right before BUY. */
export function priceFromLines(lines) {
  const i = lines.findIndex((l) => /^buy$/i.test(String(l).trim()));
  if (i <= 0) return null;
  const candidate = String(lines[i - 1]).trim();
  return parsePrice(candidate) == null ? null : candidate;
}

/**
 * Compare a listing's price, as shown on the market, with the scrap floor for
 * its rarity. `floor` is scraplib's valueAtAsk: scraps x the scrap price.
 * Nothing is added or removed on either side (editor's rule).
 */
export function verdict({ price, floor, minMarginPct = 0 }) {
  if (price == null || floor == null || !(price > 0)) return { margin: null, marginPct: null, ratio: null, coverPct: null, hit: null };
  const margin = floor - price;
  const marginPct = margin / price;
  return {
    margin,
    marginPct,
    ratio: price / floor,               // how many times its scrap floor the offer costs
    coverPct: (floor / price) * 100,    // how much of the price the scraps pay back
    hit: marginPct >= (Number(minMarginPct) || 0) / 100,
  };
}

/** Index of the readable verdict nearest its floor (smallest ratio), or -1. */
export function closestIndex(verdicts) {
  let best = -1;
  let bestRatio = Infinity;
  verdicts.forEach((v, i) => {
    if (v?.ratio != null && v.ratio < bestRatio) { bestRatio = v.ratio; best = i; }
  });
  return best;
}

/** 650675 -> "651k", 1858 -> "1.9k", 270 -> "270": the game's own shorthand. */
export function fmtQty(n) {
  if (n == null || !Number.isFinite(Number(n))) return '–';
  const v = Number(n);
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${Math.round(v / 1e3)}k`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}

// ---------- DOM-facing (exercised live on the page, not under vitest) ----------

/** The element that paints the item tile: first ancestor with a background. */
export function tileOf(img) {
  let e = img;
  while (e && e !== document.body) {
    const s = getComputedStyle(e);
    if (s.backgroundImage !== 'none' || (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent')) return e;
    e = e.parentElement;
  }
  return null;
}

const isBuyButton = (b) => /^buy$/i.test((b.innerText || '').trim());

/**
 * Every offer row on the page: walk up from each BUY button to the first
 * ancestor holding an item image; that ancestor is the row. Returns
 * { row, button, img, tile, border, rarity, priceText, price, lines }.
 */
export function offerRows(root = document) {
  const out = [];
  for (const button of [...root.querySelectorAll('button')].filter(isBuyButton)) {
    let row = button;
    let img = null;
    for (let k = 0; k < 12 && row.parentElement; k++) {
      row = row.parentElement;
      img = [...row.querySelectorAll('img')].find((i) => isItemImageAlt(i.getAttribute('alt')));
      if (img) break;
    }
    if (!img) continue;
    const tile = tileOf(img);
    const border = tile ? getComputedStyle(tile).borderColor : null;
    const lines = (row.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const priceText = priceFromLines(lines);
    out.push({ row, button, img, tile, border, rarity: rarityFromBorder(border), priceText, price: parsePrice(priceText), lines });
  }
  return out;
}

/**
 * The "Taxed price" notice element, if the page shows one. Used only as the
 * anchor the toolbar is inserted after; the rate itself plays no part in the
 * maths (editor's rule: displayed prices are compared as they are).
 */
export function taxNotice(root = document) {
  // textContent, not innerText: this sweeps every div and must not force layout.
  return [...root.querySelectorAll('div')].find((e) => {
    const t = e.textContent || '';
    return /market tax/i.test(t) && t.length < 240 && e.children.length > 0 && !e.querySelector('button');
  }) ?? null;
}

/**
 * The inventory picker that "New item offer" -> "+" opens: a dialog whose text
 * starts with "Item" and that lists every owned piece as a skin image in a
 * rarity-bordered tile (450 of them for a full inventory, read 2026-09-03).
 */
export function pickerDialog(root = document) {
  return [...root.querySelectorAll('[role="dialog"]')].find((d) => (
    isPickerText(d.textContent) && [...d.querySelectorAll('img')].some((i) => isItemImageAlt(i.getAttribute('alt')))
  )) ?? null;
}

/**
 * The picker's textContent is "Item" followed straight by the first tile's
 * numbers ("Item27050%430.5…"), no whitespace, so a word boundary after "Item"
 * does not exist there. Accept "Item" followed by anything but a letter.
 */
export function isPickerText(text) {
  return /^Item(?![A-Za-z])/.test(String(text ?? '').trim());
}

/** Every item tile in the picker: { img, tile, slot, rarity }. */
export function pickerTiles(dialog) {
  return [...dialog.querySelectorAll('img')]
    .filter((i) => isItemImageAlt(i.getAttribute('alt')))
    .map((img) => {
      const tile = tileOf(img);
      return { img, tile, slot: slotFromAlt(img.getAttribute('alt')), rarity: rarityFromBorder(tile ? getComputedStyle(tile).borderColor : null) };
    })
    .filter((t) => t.tile);
}

/** ?item=<code> from the current URL, when the list is filtered to one item. */
export function filteredItemCode(search) {
  const m = /[?&]item=([A-Za-z0-9]+)/.exec(String(search ?? ''));
  return m ? m[1] : null;
}
