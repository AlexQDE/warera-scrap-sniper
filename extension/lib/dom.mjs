// Page-reading helpers for the Scrap Sniper extension. Import-free on purpose:
// this file is pasted verbatim into the game page for live checks, and unit
// tested under vitest for everything that does not need a DOM.
//
// What the equipment market page looks like (app.warera.io/market/equipments,
// read 2026-09-03, re-read from the v0.26.0 client bundle 2026-09-16): a grid
// of "current value" tiles per slot and rarity, then a list of offers, 12 per
// page behind a Load more button. Every offer row holds the item image inside
// a frame whose BORDER colour is the only rarity signal (class names are
// hashed, image alts are skin names like "winterJet" or plain codes), then
// stats, durability, seller, age, the taxed price and a BUY button. Clicking a
// grid tile filters the list to one item code and puts ?item=<code> in the URL.
// Since v0.26 the grid tiles carry id="item-code-selector-<code>", the border
// is the theme's dark 850 shade of the rarity colour (it was the 600 shade),
// and the selected tile is drawn on top with the others dimmed.

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

/**
 * Text that goes into innerHTML of a node living in the page DOM: skin-name
 * alts read off the page, error text from the API. Markup in it would run
 * in the page's world, so it is neutralised here.
 */
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Tile border colours per rarity, as the toolbar paints its own tiles: the
 * 2026-09-03 sample (the game theme's 600 shade), kept for the toolbar and for
 * a theme revert. Reading rarity off the page goes through RARITY_PALETTE.
 */
export const RARITY_BORDERS = {
  mythic: [150, 38, 40],
  legendary: [129, 120, 45],
  epic: [94, 59, 145],
  rare: [37, 78, 167],
  uncommon: [43, 110, 68],
  common: [80, 112, 124],
};

/**
 * Every border colour an item frame is known to show, with how far a read
 * colour may sit from it. The game paints the frame border in the theme's
 * <rarity>850 shade since v0.26.0 (2026-09-16; before that the 600 shade,
 * sampled 2026-09-03) and the 700 shade while hovered; the colorblind option
 * paints epic pink. The dark shades sit close to each other (common and
 * uncommon 850 are 28 apart) and to plain panel borders, so they get a tight (12)
 * tolerance; the bright 600 shades keep the old 40. The live page is read
 * first (paletteFromSamples); this list is the fallback when the market
 * grid is not on the page.
 */
const sample = (rarity, rgb, tolerance) => ({ rarity, rgb, tolerance });
export const RARITY_PALETTE = [
  // v0.26 frame border: theme 850
  sample('mythic', [57, 15, 16], 12), sample('legendary', [43, 43, 18], 12), sample('epic', [42, 23, 69], 12),
  sample('rare', [14, 29, 63], 12), sample('uncommon', [10, 44, 28], 12), sample('common', [28, 46, 49], 12),
  sample('epic', [49, 20, 44], 12),                                                  // pink850, colorblind epic
  // hovered frame: theme 700
  sample('mythic', [113, 31, 32], 12), sample('legendary', [86, 87, 36], 12), sample('epic', [83, 46, 137], 12),
  sample('rare', [28, 58, 125], 12), sample('uncommon', [19, 88, 56], 12), sample('common', [55, 91, 98], 12),
  sample('epic', [98, 40, 89], 12),                                                  // pink700
  // the 2026-09-03 border: theme 600
  ...Object.entries(RARITY_BORDERS).map(([rarity, rgb]) => sample(rarity, rgb, 40)),
];
const CALIBRATED_TOLERANCE = 12; // a colour read off the page today is matched near-exactly

const WEAPON_RARITY = { knife: 'common', gun: 'uncommon', rifle: 'rare', sniper: 'epic', tank: 'legendary', jet: 'mythic' };

const parseRgb = (s) => {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(String(s ?? ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

/**
 * Rarity from a tile's computed border colour, or null when it is off-palette.
 * `palette` is a list of { rarity, rgb, tolerance }: the one read off the
 * page when there is one, RARITY_PALETTE otherwise.
 */
export function rarityFromBorder(color, palette = RARITY_PALETTE) {
  const rgb = parseRgb(color);
  if (!rgb) return null;
  let best = null;
  let bestD = Infinity;
  for (const p of palette) {
    const d = Math.hypot(rgb[0] - p.rgb[0], rgb[1] - p.rgb[1], rgb[2] - p.rgb[2]);
    if (d <= p.tolerance && d < bestD) { bestD = d; best = p.rarity; }
  }
  return best;
}

/**
 * A palette read off the page: { code, color } samples from tiles whose item
 * code is known (the market grid names its tiles item-code-selector-<code>).
 * One colour per rarity, the most common one, so a tile hovered at the
 * moment of reading (the 700 shade) cannot stand in for its rarity.
 */
export function paletteFromSamples(samples) {
  const votes = new Map(); // rarity -> Map(rgb key -> { rgb, n })
  for (const s of samples ?? []) {
    const rarity = rarityFromItemCode(s?.code);
    const rgb = parseRgb(s?.color);
    if (!rarity || !rgb) continue;
    const key = rgb.join(',');
    const m = votes.get(rarity) ?? new Map();
    const v = m.get(key) ?? { rgb, n: 0 };
    v.n++;
    m.set(key, v);
    votes.set(rarity, m);
  }
  const out = [];
  for (const [rarity, m] of votes) {
    const top = [...m.values()].sort((a, b) => b.n - a.n)[0];
    out.push(sample(rarity, top.rgb, CALIBRATED_TOLERANCE));
  }
  return out;
}

/** "item-code-selector-boots5" -> "boots5": the id the market grid gives each tile (v0.26). */
export function gridCodeFromId(id) {
  const m = /^item-code-selector-([A-Za-z0-9]+)$/.exec(String(id ?? ''));
  return m ? m[1] : null;
}

/**
 * The selected grid tile, from { code, opacity, zIndex } per tile: the clicked
 * tile is drawn on top (z-index 1) and the others dimmed to half opacity; with
 * nothing selected every tile sits at full opacity. Null when ambiguous.
 */
export function selectedCodeFromTiles(tiles) {
  const list = (tiles ?? []).filter((t) => t?.code);
  if (!list.length) return null;
  const onTop = list.filter((t) => String(t.zIndex) === '1');
  if (onTop.length === 1) return onTop[0].code;
  if (onTop.length > 1) return null;
  const full = list.filter((t) => Number(t.opacity) >= 0.99);
  const dimmed = list.length - full.length;
  return full.length === 1 && dimmed > 0 ? full[0].code : null;
}

/** Rarity from an item code (gameConfig.getGameConfig, 2026-09-03): gear carries its tier digit, weapons are named. */
export function rarityFromItemCode(code) {
  const c = String(code ?? '');
  const gear = /^(helmet|chest|boots|gloves|pants)([1-6])$/.exec(c);
  if (gear) return RARITIES[Number(gear[2]) - 1];
  return WEAPON_RARITY[c] ?? null;
}

// A skin name ends in the slot ("dieselBoots"); without skins the image is
// named by the plain item code ("chest2", "tank") or a label ("Chest T2").
const SLOT_RE = /(helmet|chest|gloves|pants|boots|jet|tank|sniper|rifle|gun|knife)(?:\s*t?\d+)?\s*$/i;

/** The slot off an item image name: "dieselBoots" -> boots, "chest2" -> chest, "winterJet" -> jet; null for avatars, flags, junk. */
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
 * its rarity. `floor` is scraplib's valueAtBid: scraps x the scrap price,
 * the price being the HIGHEST BUY ORDER (what the scraps fetch sold at once).
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
export function offerRows(root = document, palette = RARITY_PALETTE) {
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
    out.push({ row, button, img, tile, border, rarity: rarityFromBorder(border, palette), priceText, price: parsePrice(priceText), lines });
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
  return [...root.querySelectorAll('[role="dialog"]')].find((d) => {
    const hasItems = [...d.querySelectorAll('img')].some((i) => isItemImageAlt(i.getAttribute('alt')));
    // Once our bar is inside the card the text starts with the bar, so the bar itself is the proof.
    return hasItems && (!!d.querySelector('.ss-pick-bar') || isPickerText(d.textContent));
  }) ?? null;
}

/** The picker's card: the dialog child that is not our bar (it carries the dark background). */
export function pickerCard(dialog) {
  return [...dialog.children].find((c) => !c.classList.contains('ss-pick-bar')) ?? dialog;
}

/**
 * Show, hide, or leave alone one picker tile for the market's target item.
 * A tile the page could not describe (unknown skin name, off-palette border)
 * is never hidden: 'unknown'.
 */
export function pickerDecision(tile, target) {
  if (!tile?.slot || !tile?.rarity) return 'unknown';
  return tile.slot === target.slot && tile.rarity === target.rarity ? 'show' : 'hide';
}

/**
 * The picker's textContent is "Item" followed straight by the first tile's
 * numbers ("Item27050%430.5…"), no whitespace, so a word boundary after "Item"
 * does not exist there. Accept "Item" followed by anything but a letter.
 */
export function isPickerText(text) {
  return /^Item(?![A-Za-z])/.test(String(text ?? '').trim());
}

/**
 * Every item tile in the picker: { img, tile, cell, slot, rarity }. `cell` is
 * the flex-wrap child that holds the tile (hiding the tile alone leaves a gap
 * in the grid, hiding the cell does not).
 */
export function pickerTiles(dialog, palette = RARITY_PALETTE) {
  return [...dialog.querySelectorAll('img')]
    .filter((i) => isItemImageAlt(i.getAttribute('alt')))
    .map((img) => {
      const tile = tileOf(img);
      const parent = tile?.parentElement;
      const cell = parent && parent !== dialog && parent.children.length === 1 ? parent : tile;
      return { img, tile, cell, slot: slotFromAlt(img.getAttribute('alt')), rarity: rarityFromBorder(tile ? getComputedStyle(tile).borderColor : null, palette) };
    })
    .filter((t) => t.tile);
}

const SECTION_SLOT = { Weapons: 'weapon', Helmets: 'helmet', Chests: 'chest', Gloves: 'gloves', Pants: 'pants', Boots: 'boots' };
const WEAPON_BY_RARITY = { common: 'knife', uncommon: 'gun', rare: 'rifle', epic: 'sniper', legendary: 'tank', mythic: 'jet' };

/**
 * Which tile of the market grid is selected, from the class lists of all its
 * tiles: the clicked tile carries classes no other tile in the grid has (the
 * rarity styling repeats once per section, so it never counts). -1 when no
 * tile is unique, or more than one is.
 */
export function selectedTileIndex(classLists) {
  const counts = new Map();
  const lists = classLists.map((s) => String(s ?? '').split(/\s+/).filter(Boolean));
  for (const l of lists) for (const k of l) counts.set(k, (counts.get(k) ?? 0) + 1);
  const scores = lists.map((l) => l.filter((k) => counts.get(k) === 1).length);
  const best = Math.max(0, ...scores);
  if (best === 0) return -1;
  const winners = scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
  return winners.length === 1 ? winners[0] : -1;
}

/** A grid section heading ("Pants") and a tile rarity -> the item code ("pants2"). */
export function codeFromSelection(section, rarity) {
  const slot = SECTION_SLOT[String(section ?? '').trim()];
  const tier = RARITIES.indexOf(rarity) + 1;
  if (!slot || tier === 0) return null;
  return slot === 'weapon' ? WEAPON_BY_RARITY[rarity] : `${slot}${tier}`;
}

/** The market grid's 36 tiles as { section, tile, rarity }, in page order (pre-v0.26 build, no tile ids). */
export function gridTiles(root = document, palette = RARITY_PALETTE) {
  const grid = [...root.querySelectorAll('div')].find((e) => (e.textContent || '').trim().startsWith('Weapons') && (e.textContent || '').length < 700);
  if (!grid) return [];
  const out = [];
  const heads = [...grid.querySelectorAll('*')].filter((e) => e.children.length === 0 && SECTION_SLOT[(e.textContent || '').trim()]);
  for (const h of heads) {
    let c = h.parentElement;
    while (c && c !== grid && c.querySelectorAll('img').length < 6) c = c.parentElement;
    if (!c) continue;
    for (const img of [...c.querySelectorAll('img')].slice(0, 6)) {
      const tile = tileOf(img);
      if (tile) out.push({ section: h.textContent.trim(), tile, rarity: rarityFromBorder(getComputedStyle(tile).borderColor, palette) });
    }
  }
  return out;
}

/**
 * The market grid's tiles by the id the game gives them since v0.26
 * (item-code-selector-<code>, on the frame that carries the border):
 * { code, frame }. Empty on an older build, where gridTiles() still applies.
 */
export function gridFrames(root = document) {
  return [...root.querySelectorAll('[id^="item-code-selector-"]')]
    .map((frame) => ({ code: gridCodeFromId(frame.id), frame }))
    .filter((t) => t.code);
}

/**
 * The rarity palette as this page paints it, read off the grid's named tiles
 * (their code says the rarity, their computed border says the colour). Empty
 * when the grid is not on the page; callers fall back to RARITY_PALETTE.
 */
export function calibrateRarityBorders(root = document) {
  return paletteFromSamples(gridFrames(root).map((t) => ({ code: t.code, color: getComputedStyle(t.frame).borderColor })));
}

/** The item code the market is filtered to, read from the grid's selected tile; null when nothing is selected. */
export function selectedItemCode(root = document) {
  const frames = gridFrames(root);
  if (frames.length) {
    return selectedCodeFromTiles(frames.map((t) => {
      const s = getComputedStyle(t.frame);
      return { code: t.code, opacity: s.opacity, zIndex: s.zIndex };
    }));
  }
  const tiles = gridTiles(root);
  const i = selectedTileIndex(tiles.map((t) => t.tile.className));
  return i < 0 ? null : codeFromSelection(tiles[i].section, tiles[i].rarity);
}

/** ?item=<code> from the current URL, when the list is filtered to one item. */
export function filteredItemCode(search) {
  const m = /[?&]item=([A-Za-z0-9]+)/.exec(String(search ?? ''));
  return m ? m[1] : null;
}

// ---------- v0.26: the cases and the map (2026-09-16) ----------

/** The nearest element that holds both `a` and `b`, or null. */
export function lowestCommonAncestor(a, b) {
  const seen = new Set();
  for (let e = a; e; e = e.parentElement) seen.add(e);
  for (let e = b; e; e = e.parentElement) if (seen.has(e)) return e;
  return null;
}

const CASE_IMG_CODES = ['woodenCase', 'case1', 'case2'];

/**
 * Where the case strip goes: before the block that holds the case tiles. On
 * the resource market that is the grid (tiles named item-code-selector-<code>);
 * on an inventory page it is the tiles whose image is named by the case code
 * (cases have no skins). Null when no case tile is on the page.
 */
export function casesAnchor(root = document) {
  const byId = CASE_IMG_CODES.map((c) => root.querySelector(`[id="item-code-selector-${c}"]`)).filter(Boolean);
  if (byId.length) {
    // the grid: the case tiles and a tile of another section share the block that holds every section
    const other = root.querySelector('[id="item-code-selector-scraps"], [id="item-code-selector-oil"], [id="item-code-selector-knife"]');
    let anchor = byId[0];
    for (const f of [...byId.slice(1), ...(other ? [other] : [])]) anchor = lowestCommonAncestor(anchor, f) ?? anchor;
    if (!other) anchor = anchor.parentElement ?? anchor;   // only the cases section: step out to its section box
    return anchor;
  }
  const frames = [...root.querySelectorAll('img')].filter((i) => CASE_IMG_CODES.includes(i.getAttribute('alt'))).map((i) => tileOf(i)).filter(Boolean);
  if (!frames.length) return null;
  let anchor = frames[0];
  for (const f of frames.slice(1)) anchor = lowestCommonAncestor(anchor, f) ?? anchor;
  // one tile alone: step out of its cell so the strip does not land inside a tile
  if (frames.length === 1) anchor = anchor.parentElement?.parentElement ?? anchor;
  return anchor;
}

const NEAREST_CASE_LABEL = 'Nearest wooden case';   // lingui py72Hd, the same text in every catalog read (EN, SR)
const REGIONS_AWAY_RE = /(\d+)\s*regions?\s+away/i;   // lingui sX+lDG

/**
 * The map menu's "Nearest wooden case" item: { item, text, hops }. `item` is
 * the smallest element holding the label and the "N regions away" subtitle
 * (the trip line is appended inside it); `hops` is null while the game shows
 * the km fallback or no case waits.
 */
export function mapLootItem(root = document) {
  const els = [...root.querySelectorAll('button, div, span, p, a')].filter((e) => {
    const t = (e.textContent || '').trim();
    return t.startsWith(NEAREST_CASE_LABEL) && t.length < 320;
  });
  if (!els.length) return null;
  const withHops = els.filter((e) => REGIONS_AWAY_RE.test(e.textContent || ''));
  const pool = withHops.length ? withHops : els;
  const item = pool[pool.length - 1];   // document order lists ancestors first, so the last one is the deepest
  const m = REGIONS_AWAY_RE.exec(item.textContent || '');
  return { item, text: (item.textContent || '').trim(), hops: m ? Number(m[1]) : null };
}
