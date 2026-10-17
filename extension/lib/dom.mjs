// WarEra Plus DOM adapter. Historical layout observations below are retained
// from the repository; pure readers and synthetic DOM fixtures run in Vitest.
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

import { RARITIES, WEAPONS } from "./items.mjs";
export { RARITIES } from "./items.mjs";
export { escapeHtml, fmtQty } from "./format.mjs";

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
  sample("mythic", [57, 15, 16], 12),
  sample("legendary", [43, 43, 18], 12),
  sample("epic", [42, 23, 69], 12),
  sample("rare", [14, 29, 63], 12),
  sample("uncommon", [10, 44, 28], 12),
  sample("common", [28, 46, 49], 12),
  sample("epic", [49, 20, 44], 12), // pink850, colorblind epic
  // v0.27 frame border (dev 2026-10-17, read off the 36 tiles of the "Select an item" modal)
  sample("mythic", [88, 27, 29], 12),
  sample("legendary", [53, 54, 16], 12),
  sample("epic", [59, 35, 95], 12),
  sample("rare", [23, 48, 101], 12),
  sample("uncommon", [10, 61, 40], 12),
  sample("common", [26, 56, 62], 12),
  // hovered frame: theme 700
  sample("mythic", [113, 31, 32], 12),
  sample("legendary", [86, 87, 36], 12),
  sample("epic", [83, 46, 137], 12),
  sample("rare", [28, 58, 125], 12),
  sample("uncommon", [19, 88, 56], 12),
  sample("common", [55, 91, 98], 12),
  sample("epic", [98, 40, 89], 12), // pink700
  // the 2026-09-03 border: theme 600
  ...Object.entries(RARITY_BORDERS).map(([rarity, rgb]) =>
    sample(rarity, rgb, 40),
  ),
];
const CALIBRATED_TOLERANCE = 12; // a colour read off the page today is matched near-exactly

const WEAPON_RARITY = Object.fromEntries(
  WEAPONS.map((code, i) => [code, RARITIES[i]]),
);

const parseRgb = (s) => {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(String(s ?? ""));
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
    const d = Math.hypot(
      rgb[0] - p.rgb[0],
      rgb[1] - p.rgb[1],
      rgb[2] - p.rgb[2],
    );
    if (d <= p.tolerance && d < bestD) {
      bestD = d;
      best = p.rarity;
    }
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
    const key = rgb.join(",");
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
  const m = /^item-code-selector-([A-Za-z0-9]+)$/.exec(String(id ?? ""));
  return m ? m[1] : null;
}

/** Preserve known hover/accessibility shades when live calibration is available. */
export function withFallbackPalette(live) {
  return [...(live ?? []), ...RARITY_PALETTE];
}

/**
 * The selected grid tile, from { code, opacity, zIndex } per tile: the clicked
 * tile is drawn on top (z-index 1) and the others dimmed to half opacity; with
 * nothing selected every tile sits at full opacity. Null when ambiguous.
 */
export function selectedCodeFromTiles(tiles) {
  const list = (tiles ?? []).filter((t) => t?.code);
  if (!list.length) return null;
  const onTop = list.filter((t) => String(t.zIndex) === "1");
  if (onTop.length === 1) return onTop[0].code;
  if (onTop.length > 1) return null;
  const full = list.filter((t) => Number(t.opacity) >= 0.99);
  const dimmed = list.length - full.length;
  return full.length === 1 && dimmed > 0 ? full[0].code : null;
}

/** Rarity from an item code (gameConfig.getGameConfig, 2026-09-03): gear carries its tier digit, weapons are named. */
export function rarityFromItemCode(code) {
  const c = String(code ?? "");
  const gear = /^(helmet|chest|boots|gloves|pants)([1-6])$/.exec(c);
  if (gear) return RARITIES[Number(gear[2]) - 1];
  return WEAPON_RARITY[c] ?? null;
}

// A skin name ends in the slot ("dieselBoots"); without skins the image is
// named by the plain item code ("chest2", "tank") or a label ("Chest T2").
const SLOT_RE =
  /(helmet|chest|gloves|pants|boots|jet|tank|sniper|rifle|gun|knife)(?:\s*t?\d+)?\s*$/i;

/** The slot off an item image name: "dieselBoots" -> boots, "chest2" -> chest, "winterJet" -> jet; null for avatars, flags, junk. */
export function slotFromAlt(alt) {
  const a = String(alt ?? "").trim();
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
  return t ? `${t.rarity} ${t.slot}` : String(code ?? "");
}
/** "helmet" for helmet1, "jet" for jet: the label without its rarity, where the tier is already said. */
export const slotName = (code) =>
  itemLabel(code).split(" ").slice(1).join(" ") || String(code ?? "");

/** "392.991", "1,234.5", "1.858K" -> number; anything else -> null. */
export function parsePrice(text) {
  const m = /^\s*([\d,]+(?:\.\d+)?)\s*([KkMm])?\s*$/.exec(String(text ?? ""));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const mult = m[2] ? { k: 1e3, m: 1e6 }[m[2].toLowerCase()] : 1;
  return n * mult;
}

/** Item images carry a skin name; avatars and flags are the other images in a row. */
export function isItemImageAlt(alt) {
  const a = String(alt ?? "").trim();
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
  if (price == null || floor == null || !(price > 0))
    return {
      margin: null,
      marginPct: null,
      ratio: null,
      coverPct: null,
      hit: null,
    };
  const margin = floor - price;
  const marginPct = margin / price;
  return {
    margin,
    marginPct,
    ratio: price / floor, // how many times its scrap floor the offer costs
    coverPct: (floor / price) * 100, // how much of the price the scraps pay back
    hit:
      margin >= 0 && marginPct >= Math.max(0, Number(minMarginPct) || 0) / 100,
    near: margin < 0 && minMarginPct < 0 && marginPct >= minMarginPct / 100,
  };
}

/** Best relative value (smallest price/floor), not distance from break-even. */
export function closestIndex(verdicts) {
  let best = -1;
  let bestRatio = Infinity;
  verdicts.forEach((v, i) => {
    if (v?.ratio != null && v.ratio < bestRatio) {
      bestRatio = v.ratio;
      best = i;
    }
  });
  return best;
}

// ---------- DOM-facing ----------

/** The element that paints the item tile: first ancestor with a background. */
export function tileOf(img) {
  let e = img;
  while (e && e !== document.body) {
    const s = getComputedStyle(e);
    if (
      (s.backgroundImage && s.backgroundImage !== "none") ||
      (s.backgroundColor &&
        s.backgroundColor !== "rgba(0, 0, 0, 0)" &&
        s.backgroundColor !== "transparent")
    )
      return e;
    e = e.parentElement;
  }
  return null;
}

// textContent, not innerText: this runs for every button on the page and must not force layout.
const isBuyButton = (b) => /^\s*buy\s*$/i.test(b.textContent || "");

/** A row's own text, without the nodes this extension appended to it: cheap (no layout) and stable across our own writes. */
function nativeRowText(row) {
  let t = "";
  for (const c of row.childNodes) {
    if (c.nodeType === 1 && c.hasAttribute("data-lens")) continue;
    t += c.textContent;
  }
  return t;
}

/**
 * The per-row read cache offerRows() fills: the layout-forcing innerText of a
 * row is read once per distinct native text, not once per scan. `reads`
 * counts the innerText reads, for the loader benchmark.
 */
export function createRowCache() {
  return { rows: new WeakMap(), reads: 0, styleReads: 0, epoch: 0 };
}

/**
 * Every offer row under `root`: walk up from each BUY button to the first
 * ancestor holding an item image; that ancestor is the row. Returns
 * { row, button, img, alt, tile, border, rarity, priceText, price, lines }.
 * With a cache (createRowCache) a row whose native text did not change
 * reuses its parsed lines and price.
 */
export function offerRows(
  root = document,
  palette = RARITY_PALETTE,
  cache = null,
) {
  const out = [];
  for (const button of [...root.querySelectorAll("button")].filter(
    isBuyButton,
  )) {
    let row = button;
    let img = null;
    for (let k = 0; k < 12 && row.parentElement; k++) {
      row = row.parentElement;
      img = [...row.querySelectorAll("img")].find((i) =>
        isItemImageAlt(i.getAttribute("alt")),
      );
      if (img) break;
    }
    if (!img) continue;
    const text = nativeRowText(row);
    let read = cache?.rows.get(row);
    if (!read || read.text !== text) {
      if (cache) cache.reads++;
      const lines = (row.innerText || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const priceText = priceFromLines(lines);
      read = { text, lines, priceText, price: parsePrice(priceText) };
      cache?.rows.set(row, read);
    }
    // The frame and its border colour (the rarity signal) are read once per
    // cache epoch: a row keeps its frame, and the epoch turns on every full
    // scan so a theme change (colorblind palette, hover shade) is picked up.
    if (
      !read.style ||
      read.style.epoch !== (cache?.epoch ?? 0) ||
      read.style.img !== img ||
      !read.style.tile?.isConnected
    ) {
      if (cache) cache.styleReads++;
      const tile = tileOf(img);
      read.style = {
        epoch: cache?.epoch ?? 0,
        img,
        tile,
        border: tile ? getComputedStyle(tile).borderColor : null,
      };
    }
    out.push({
      row,
      button,
      img,
      alt: img.getAttribute("alt"),
      tile: read.style.tile,
      border: read.style.border,
      rarity: rarityFromBorder(read.style.border, palette),
      priceText: read.priceText,
      price: read.price,
      lines: read.lines,
    });
  }
  return out;
}

/**
 * The game's buttons that look like an offer's (BUY, BUY NOW, BID) on the page: when the page shows some and no
 * row reads, the game changed under the reader and the bar says so instead of staying silent.
 * @param {ParentNode} [root]
 */
export function offerButtonCount(root = document) {
  let n = 0;
  for (const b of root.querySelectorAll("button"))
    // the amount follows the word with no space in textContent ("Bid218.9"), so no \b after it
    if (
      /^\s*(buy|bid)(?![a-z])/i.test(b.textContent || "") &&
      !b.closest("[data-lens]")
    )
      n++;
  return n;
}

// ---------- v0.27: the auction house (dev 2026-10-17) ----------

/** One part of a countdown, or a whole one: "5h", "35m", "28s", "6d23h26m6s". */
const COUNTDOWN_RE = /^(\d+\s*[dhms]\s*)+$/i;
/** An amount as the auction cards print it: "199", "277.927", "1,234.5". */
const AMOUNT_RE = /^\d[\d,]*(\.\d+)?$/;
const UNIT_SECONDS = { d: 86_400, h: 3_600, m: 60, s: 1 };

/** A card's countdown in seconds ("5h35m28s" -> 20128); null for what reads as none (a translated one). */
export function countdownSeconds(text) {
  const t = String(text ?? "").trim();
  if (!COUNTDOWN_RE.test(t)) return null;
  let seconds = 0;
  for (const [, n, unit] of t.matchAll(/(\d+)\s*([dhms])/gi))
    seconds += Number(n) * UNIT_SECONDS[unit.toLowerCase()];
  return seconds;
}

/**
 * An element's text as tokens, in page order, without the extension's own
 * nodes and (unless `buttons`) without the text of the buttons inside it.
 * What the page prints in pieces is joined: a "%" to the number before it,
 * a decimal's "." and digits to its whole part ("277", ".", "927" ->
 * "277.927"), a countdown's units ("5h", "35m", "28s" -> "5h35m28s").
 * @param {Element} el @param {{ buttons?: boolean }} [options]
 * @returns {string[]}
 */
export function auctionTokens(el, { buttons = false } = {}) {
  /** @type {string[]} */
  const out = [];
  const walk = el.ownerDocument.createTreeWalker(el, 4 /* SHOW_TEXT */);
  while (walk.nextNode()) {
    const node = walk.currentNode;
    const parent = node.parentElement;
    if (parent?.closest("[data-lens]")) continue;
    if (!buttons) {
      const b = parent?.closest("button");
      if (b && b !== el && el.contains(b)) continue;
    }
    const v = String(node.nodeValue ?? "").trim();
    if (!v) continue;
    const last = out.at(-1) ?? "";
    if (v === "%" && out.length) out[out.length - 1] += "%";
    else if (/^\.\d*$/.test(v) && /^\d[\d,]*$/.test(last))
      out[out.length - 1] += v;
    else if (/^\d+$/.test(v) && /^\d[\d,]*\.$/.test(last))
      out[out.length - 1] += v;
    else if (COUNTDOWN_RE.test(v) && COUNTDOWN_RE.test(last))
      out[out.length - 1] += v;
    else out.push(v);
  }
  return out;
}

/**
 * The amount a button carries ("Buy now" 305.72, "Bid" 218.9): its last token, when that is an amount after a
 * label (a pager's "2" is no price).
 */
function buttonAmount(button) {
  // most of the page's buttons carry no digit at all: they are passed over before any text walk
  if (!/\d/.test(button.textContent || "")) return null;
  const tokens = auctionTokens(button, { buttons: true });
  const t = tokens.at(-1) ?? "";
  return AMOUNT_RE.test(t) &&
    tokens.slice(0, -1).some((x) => !AMOUNT_RE.test(x))
    ? { text: t, value: parsePrice(t) }
    : null;
}

/**
 * What an auction card says, by position (its labels are translated): the
 * stats before the item's name, the countdown, then two amounts, the start
 * (the current bid once someone bid) and the max price, both before tax.
 * Without a countdown the amounts are the first two after the name.
 * @param {ReadonlyArray<string>} tokens
 */
export function readAuctionTokens(tokens) {
  let i = 0;
  while (i < tokens.length && /^\d+%?$/.test(tokens[i])) i++;
  // the countdown comes before the prices: a seller called "24h" after them is not one
  const first = tokens.findIndex((t, k) => k > i && AMOUNT_RE.test(t));
  const cd = tokens.findIndex(
    (t, k) => k > i && (first < 0 || k < first) && COUNTDOWN_RE.test(t),
  );
  /** @type {Array<{ text: string, value: number }>} */
  const amounts = [];
  for (let k = cd >= 0 ? cd + 1 : i + 1; k < tokens.length; k++) {
    if (amounts.length === 2) break;
    if (AMOUNT_RE.test(tokens[k]))
      amounts.push({
        text: tokens[k],
        value: Number(tokens[k].replace(/,/g, "")),
      });
  }
  return {
    name: tokens[i] ?? null,
    ends: cd >= 0 ? tokens[cd] : null,
    start: amounts[0]?.value ?? null,
    max: amounts[1]?.value ?? null,
  };
}

/**
 * Every auction card under `root` (v0.27): a card shows one piece and carries
 * exactly two buttons with a labelled amount, buy-now then bid, whose amounts
 * include the buyer's market tax; the card's own start and max price do not,
 * so its buy now is its max price and a tax of 0 to 50%. Rows
 * have offerRows' shape (row, button, img, alt, tile, border, rarity,
 * priceText, price = the buy-now amount, lines) plus kind "auction", the bid
 * button and its amount, start, max, the countdown and the card's tokens. A
 * card whose native text did not change reuses its read (the cache).
 */
export function auctionRows(
  root = document,
  palette = RARITY_PALETTE,
  cache = null,
) {
  const out = [];
  const cards = new Set();
  for (const button of root.querySelectorAll("button")) {
    if (button.closest("[data-lens]") || !buttonAmount(button)) continue;
    let card = button;
    let img = null;
    for (let k = 0; k < 10 && card.parentElement; k++) {
      card = card.parentElement;
      img =
        [...card.querySelectorAll("img")].find(
          (i) => isItemImageAlt(i.getAttribute("alt")) && !i.closest("button"),
        ) ?? null;
      if (img) break;
    }
    if (!img || cards.has(card)) continue;
    cards.add(card);
    // a card shows one piece: an ancestor that shows more is a list, whatever buttons it holds
    const pieces = [...card.querySelectorAll("img")].filter(
      (i) => !i.closest("button") && slotFromAlt(i.getAttribute("alt")),
    );
    if (pieces.length > 1) continue;
    const priced = [...card.querySelectorAll("button")].filter(
      (b) => !b.closest("[data-lens]") && buttonAmount(b),
    );
    if (priced.length !== 2) continue;
    const [buy, bidButton] = priced;
    const text = nativeRowText(card);
    let read = cache?.rows.get(card);
    if (!read || read.text !== text || !read.auction) {
      if (cache) cache.reads++;
      const tokens = auctionTokens(card);
      const buyAmount = buttonAmount(buy);
      const bidAmount = buttonAmount(bidButton);
      read = {
        text,
        auction: true,
        tokens,
        ...readAuctionTokens(tokens),
        priceText: buyAmount?.text ?? null,
        price: buyAmount?.value ?? null,
        bidText: bidAmount?.text ?? null,
        bid: bidAmount?.value ?? null,
        // the countdown changes the text every second, not the frame: its read stays (checked below)
        style: read?.style,
      };
      cache?.rows.set(card, read);
    }
    // a lone piece above two labelled numbers (a pager) has no max price its first number is a tax away from
    const slack = Math.max(0.02, 0.002 * (read.price ?? 0));
    if (
      !(read.price > 0 && read.max > 0) ||
      read.price < read.max - slack ||
      read.price > read.max * 1.5 + slack
    )
      continue;
    if (
      !read.style ||
      read.style.epoch !== (cache?.epoch ?? 0) ||
      read.style.img !== img ||
      !read.style.tile?.isConnected
    ) {
      if (cache) cache.styleReads++;
      const tile = tileOf(img);
      read.style = {
        epoch: cache?.epoch ?? 0,
        img,
        tile,
        border: tile ? getComputedStyle(tile).borderColor : null,
      };
    }
    out.push({
      kind: "auction",
      row: card,
      button: buy,
      bidButton,
      img,
      alt: img.getAttribute("alt"),
      tile: read.style.tile,
      border: read.style.border,
      rarity: rarityFromBorder(read.style.border, palette),
      tokens: read.tokens,
      lines: read.tokens,
      priceText: read.priceText,
      price: read.price,
      bidText: read.bidText,
      bid: read.bid,
      start: read.start,
      max: read.max,
      ends: read.ends,
    });
  }
  return out;
}

/** The game build the page runs (Next.js buildId), for notices; null when the page does not say. */
let buildIdSeen = null;
export function buildId(root = document) {
  if (buildIdSeen) return buildIdSeen;
  const m = /"buildId":"([^"]+)"/.exec(
    root.getElementById?.("__NEXT_DATA__")?.textContent ?? "",
  );
  buildIdSeen = m ? m[1] : null;
  return buildIdSeen;
}

/**
 * The buyer's tax an auction card's buttons carry: the notice's rate (in
 * percent) when it prints one, checked against the card (BUY NOW is the max
 * price plus the tax, to the game's rounding: 0.02 or 0.2%); without a rate
 * on the page the card's own BUY NOW / max - 1, between 0 and 50%. ok false:
 * the card and the notice disagree, or the card cannot say; no verdict rests
 * on the card then.
 * @param {{ price: number | null, max: number | null }} card @param {number | null} noticePct
 * @returns {{ rate: number | null, source: "notice" | "card" | null, ok: boolean }}
 */
export function auctionTax({ price, max }, noticePct) {
  if (!(Number(price) > 0) || !(Number(max) > 0))
    return { rate: null, source: null, ok: false };
  const p = Number(price);
  const m = Number(max);
  if (noticePct != null && Number.isFinite(Number(noticePct))) {
    const rate = Number(noticePct) / 100;
    return {
      rate,
      source: "notice",
      ok: Math.abs(p - m * (1 + rate)) <= Math.max(0.02, 0.002 * p),
    };
  }
  const rate = Math.round((p / m - 1) * 1000) / 1000;
  return rate >= 0 && rate <= 0.5
    ? { rate, source: "card", ok: true }
    : { rate: null, source: null, ok: false };
}

/** The smallest element holding every row, or null: the scope later scans start from. */
export function rowsContainer(rows) {
  if (rows.length < 2) return null; // one row says nothing about where the others will go
  let common = rows[0]?.row?.parentElement ?? null;
  for (const r of rows.slice(1)) {
    if (!common) break;
    common = lowestCommonAncestor(common, r.row.parentElement);
  }
  return common &&
    common !== document.body &&
    common !== document.documentElement
    ? common
    : null;
}

/**
 * The market-tax notice element, if the page shows one: since 2026-09-09
 * "All prices displayed include a 1% market tax from your country" (earlier
 * builds printed "Taxed price"). The anchor the toolbar is inserted after;
 * the rate plays no part in the scrap maths (editor's rule: displayed prices
 * are compared as they are), the Craft Desk shows it as the buyer's rate.
 */
let taxCache = null;
export function taxNotice(root = document) {
  // The notice found last time is reused while it is still on the page and still says so.
  if (
    taxCache?.isConnected &&
    root.contains(taxCache) &&
    /market tax/i.test(taxCache.textContent || "")
  )
    return taxCache;
  // textContent, not innerText: this sweeps every div and must not force layout.
  taxCache =
    [...root.querySelectorAll("div")].find((e) => {
      const t = e.textContent || "";
      return (
        /market tax/i.test(t) &&
        t.length < 240 &&
        e.children.length > 0 &&
        !e.querySelector("button")
      );
    }) ?? null;
  return taxCache;
}

/**
 * The rate the notice prints, when it prints one: "Market tax 5%" -> 5 and
 * the live "All prices displayed include a 1% market tax from your country"
 * -> 1 (the number comes before the words there). null otherwise, and the
 * rate is then a manual input.
 */
export function taxRateFromText(text) {
  const s = String(text ?? "");
  const m =
    /market tax[^0-9%]{0,40}?(\d+(?:[.,]\d+)?)\s*%/i.exec(s) ??
    /(\d+(?:[.,]\d+)?)\s*%\s*market tax/i.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/**
 * The logged-in player's own id, read off the page's own-profile links: the
 * header links to `/user/<id>/inventory` and `/user/<id>/skills` for the
 * player, never for anyone else (chat and ranking links point at `/user/<id>`
 * with no such suffix). Two different ids on one page, or none, is null;
 * the player can then set the id in settings.
 * @param {ParentNode} [root]
 */
export function ownUserId(root = document) {
  const ids = new Set();
  for (const a of root.querySelectorAll('a[href^="/user/"]')) {
    const m = /^\/user\/([0-9a-f]{24})\/(inventory|skills)$/.exec(
      a.getAttribute("href") ?? "",
    );
    if (m) ids.add(m[1]);
  }
  return ids.size === 1 ? [...ids][0] : null;
}

/**
 * The inventory picker that "New item offer" -> "+" opens: a dialog whose text
 * starts with "Item" and that lists every owned piece as a skin image in a
 * rarity-bordered tile (450 of them for a full inventory, read 2026-09-03).
 */
export function pickerDialog(root = document) {
  return (
    [...root.querySelectorAll('[role="dialog"]')].find((d) => {
      const hasItems = [...d.querySelectorAll("img")].some((i) =>
        isItemImageAlt(i.getAttribute("alt")),
      );
      // Once our bar is inside the card the text starts with the bar, so the bar itself is the proof.
      return (
        hasItems &&
        (!!d.querySelector(".ss-pick-bar") || isPickerText(d.textContent))
      );
    }) ?? null
  );
}

/** The picker's card: the dialog child that is not our bar (it carries the dark background). */
export function pickerCard(dialog) {
  return (
    [...dialog.children].find((c) => !c.classList.contains("ss-pick-bar")) ??
    dialog
  );
}

/**
 * Where the extension's bar goes in the picker: right after the card's title
 * ("Items"), so it stays in view while the list scrolls. The v0.27 dialog's
 * first child is a full-screen backdrop, so the card is found from a tile
 * upwards: the first ancestor with a child that is only the title. null when
 * there is none (the caller falls back to pickerCard).
 * @param {Element} dialog
 * @returns {{ card: Element, title: Element } | null}
 */
export function pickerTitle(dialog) {
  const img = [...dialog.querySelectorAll("img")].find((i) =>
    isItemImageAlt(i.getAttribute("alt")),
  );
  for (let n = img?.parentElement; n && n !== dialog; n = n.parentElement) {
    const title = [...n.children].find(
      (c) =>
        !c.classList.contains("ss-pick-bar") &&
        /^\s*(items?|quick dismantle)\s*$/i.test(c.textContent ?? ""),
    );
    if (title) return { card: n, title };
  }
  return null;
}

/**
 * Show, hide, or leave alone one picker tile for the market's target item.
 * A tile the page could not describe (unknown skin name, off-palette border)
 * is never hidden: 'unknown'.
 */
export function pickerDecision(tile, target) {
  if (!tile?.slot || !tile?.rarity) return "unknown";
  return tile.slot === target.slot && tile.rarity === target.rarity
    ? "show"
    : "hide";
}

/**
 * The picker's textContent is "Item" followed straight by the first tile's
 * numbers ("Item27050%430.5…"), no whitespace, so a word boundary after "Item"
 * does not exist there. Accept "Item" followed by anything but a letter.
 */
export function isPickerText(text) {
  const t = String(text ?? "").trim();
  // v0.27: "Items" and the selection counter ("Items0/5…"), and the inventory's "Quick dismantle"
  // window of the same tiles; "Items for sale" is something else
  return (
    /^Item(?![A-Za-z])/.test(t) ||
    /^Items\d+\/\d+/.test(t) ||
    /^Quick dismantle/i.test(t)
  );
}

/**
 * The market's minimum-stat filter under a selected item (inputs named by
 * the stat: attack, criticalChance, read live 2026-10-11), for `keys`:
 * { attack: 120, criticalChance: 20 }; a field left empty is left out.
 * @param {ReadonlyArray<string>} keys
 */
export function statFilter(keys, root = document) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const k of keys) {
    const input = /** @type {HTMLInputElement | null} */ (
      root.querySelector(`input[name="${k}"]`)
    );
    const text = String(input?.value ?? "").trim();
    const v = Number(text);
    if (text && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/**
 * Every item tile in the picker: { img, tile, cell, slot, rarity }. `cell` is
 * the flex-wrap child that holds the tile (hiding the tile alone leaves a gap
 * in the grid, hiding the cell does not).
 */
export function pickerTiles(dialog, palette = RARITY_PALETTE) {
  return [...dialog.querySelectorAll("img")]
    .filter((i) => isItemImageAlt(i.getAttribute("alt")))
    .map((img) => {
      const tile = tileOf(img);
      const parent = tile?.parentElement;
      const cell =
        parent && parent !== dialog && parent.children.length === 1
          ? parent
          : tile;
      return {
        img,
        tile,
        cell,
        slot: slotFromAlt(img.getAttribute("alt")),
        rarity: rarityFromBorder(
          tile ? getComputedStyle(tile).borderColor : null,
          palette,
        ),
      };
    })
    .filter((t) => t.tile);
}

const SECTION_SLOT = {
  Weapons: "weapon",
  Helmets: "helmet",
  Chests: "chest",
  Gloves: "gloves",
  Pants: "pants",
  Boots: "boots",
};
const WEAPON_BY_RARITY = Object.fromEntries(
  RARITIES.map((rarity, i) => [rarity, WEAPONS[i]]),
);

/**
 * Which tile of the market grid is selected, from the class lists of all its
 * tiles: the clicked tile carries classes no other tile in the grid has (the
 * rarity styling repeats once per section, so it never counts). -1 when no
 * tile is unique, or more than one is.
 */
export function selectedTileIndex(classLists) {
  const counts = new Map();
  const lists = classLists.map((s) =>
    String(s ?? "")
      .split(/\s+/)
      .filter(Boolean),
  );
  for (const l of lists)
    for (const k of l) counts.set(k, (counts.get(k) ?? 0) + 1);
  const scores = lists.map((l) => l.filter((k) => counts.get(k) === 1).length);
  const best = Math.max(0, ...scores);
  if (best === 0) return -1;
  const winners = scores
    .map((s, i) => (s === best ? i : -1))
    .filter((i) => i >= 0);
  return winners.length === 1 ? winners[0] : -1;
}

/** A grid section heading ("Pants") and a tile rarity -> the item code ("pants2"). */
export function codeFromSelection(section, rarity) {
  const slot = SECTION_SLOT[String(section ?? "").trim()];
  const tier = RARITIES.indexOf(rarity) + 1;
  if (!slot || tier === 0) return null;
  return slot === "weapon" ? WEAPON_BY_RARITY[rarity] : `${slot}${tier}`;
}

/** The market grid's 36 tiles as { section, tile, rarity }, in page order (pre-v0.26 build, no tile ids). */
export function gridTiles(root = document, palette = RARITY_PALETTE) {
  const grid = [...root.querySelectorAll("div")].find(
    (e) =>
      (e.textContent || "").trim().startsWith("Weapons") &&
      (e.textContent || "").length < 700,
  );
  if (!grid) return [];
  const out = [];
  const heads = [...grid.querySelectorAll("*")].filter(
    (e) =>
      e.children.length === 0 && SECTION_SLOT[(e.textContent || "").trim()],
  );
  for (const h of heads) {
    let c = h.parentElement;
    while (c && c !== grid && c.querySelectorAll("img").length < 6)
      c = c.parentElement;
    if (!c) continue;
    for (const img of [...c.querySelectorAll("img")].slice(0, 6)) {
      const tile = tileOf(img);
      if (tile)
        out.push({
          section: h.textContent.trim(),
          tile,
          rarity: rarityFromBorder(getComputedStyle(tile).borderColor, palette),
        });
    }
  }
  return out;
}

/**
 * The market grid's tiles by the id the game gives them since v0.26
 * (item-code-selector-<code>, on the frame that carries the border):
 * { code, frame }. Empty on an older build, where gridTiles() still applies.
 */
const framesCache = new WeakMap();
export function gridFrames(root = document) {
  // Reused while every frame found last time is still on the page; a re-rendered grid leaves them disconnected.
  const cached = framesCache.get(root);
  if (cached?.length && cached.every((t) => t.frame.isConnected)) return cached;
  const frames = [...root.querySelectorAll('[id^="item-code-selector-"]')]
    .map((frame) => ({ code: gridCodeFromId(frame.id), frame }))
    .filter((t) => t.code);
  framesCache.set(root, frames);
  return frames;
}

/**
 * Where the equipment market's panels go: before the tax notice, else before
 * the section that holds the item grid; null when neither is on the page, so
 * callers clear. One rule for the equipment bar and the Craft Desk, so the
 * desk still has a place when the Equipment module is off.
 * @param {Document | Element} [root]
 */
export function marketAnchor(root = document) {
  return (
    taxNotice(root) ??
    gridFrames(root)[0]?.frame?.parentElement?.parentElement ??
    null
  );
}

/**
 * The rarity palette as this page paints it, read off the grid's named tiles
 * (their code says the rarity, their computed border says the colour). Empty
 * when the grid is not on the page; callers fall back to RARITY_PALETTE.
 */
export function calibrateRarityBorders(root = document) {
  return paletteFromSamples(
    gridFrames(root).map((t) => ({
      code: t.code,
      color: getComputedStyle(t.frame).borderColor,
    })),
  );
}

/** The item code the market is filtered to, read from the grid's selected tile; null when nothing is selected. */
export function selectedItemCode(root = document) {
  const frames = gridFrames(root);
  if (frames.length) {
    return selectedCodeFromTiles(
      frames.map((t) => {
        const s = getComputedStyle(t.frame);
        return { code: t.code, opacity: s.opacity, zIndex: s.zIndex };
      }),
    );
  }
  const tiles = gridTiles(root);
  const i = selectedTileIndex(tiles.map((t) => t.tile.className));
  return i < 0 ? null : codeFromSelection(tiles[i].section, tiles[i].rarity);
}

/** ?item=<code> from the current URL, when the list is filtered to one item. */
export function filteredItemCode(search) {
  const m = /[?&]item=([A-Za-z0-9]+)/.exec(String(search ?? ""));
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

const CASE_IMG_CODES = ["woodenCase", "case1", "case2"];

/**
 * Where the case strip goes: before the block that holds the case tiles. On
 * the resource market that is the grid (tiles named item-code-selector-<code>);
 * on an inventory page it is the tiles whose image is named by the case code
 * (cases have no skins). Null when no case tile is on the page.
 */
export function casesAnchor(root = document) {
  const byId = CASE_IMG_CODES.map((c) =>
    root.querySelector(`[id="item-code-selector-${c}"]`),
  ).filter(Boolean);
  if (byId.length) {
    // the grid: the case tiles and a tile of another section share the block that holds every section
    const other = root.querySelector(
      '[id="item-code-selector-scraps"], [id="item-code-selector-oil"], [id="item-code-selector-knife"]',
    );
    let anchor = byId[0];
    for (const f of [...byId.slice(1), ...(other ? [other] : [])])
      anchor = lowestCommonAncestor(anchor, f) ?? anchor;
    if (!other) anchor = anchor.parentElement ?? anchor; // only the cases section: step out to its section box
    return anchor;
  }
  const frames = [...root.querySelectorAll("img")]
    .filter((i) => CASE_IMG_CODES.includes(i.getAttribute("alt")))
    .map((i) => tileOf(i))
    .filter(Boolean);
  if (!frames.length) return null;
  let anchor = frames[0];
  for (const f of frames.slice(1))
    anchor = lowestCommonAncestor(anchor, f) ?? anchor;
  // one tile alone: step out of its cell so the strip does not land inside a tile
  if (frames.length === 1)
    anchor = anchor.parentElement?.parentElement ?? anchor;
  return anchor;
}

const NEAREST_CASE_LABEL = "Nearest wooden case"; // lingui py72Hd, the same text in every catalog read (EN, SR)
const REGIONS_AWAY_RE = /(\d+)\s*regions?\s+away/i; // lingui sX+lDG
const mapCache = new WeakMap();
function nativeText(el) {
  const copy = el.cloneNode(true);
  for (const node of copy.querySelectorAll("[data-lens], .ss-trip"))
    node.remove();
  return (copy.textContent || "").trim();
}

/**
 * The map menu's "Nearest wooden case" item: { item, text, hops }. `item` is
 * the smallest element holding the label and the "N regions away" subtitle
 * (the trip line is appended inside it); `hops` is null while the game shows
 * the km fallback or no case waits.
 */
export function mapLootItem(root = document) {
  const cached = mapCache.get(root);
  if (cached?.isConnected) {
    const text = nativeText(cached);
    if (text.startsWith(NEAREST_CASE_LABEL))
      return {
        item: cached,
        text,
        hops: REGIONS_AWAY_RE.test(text)
          ? Number(REGIONS_AWAY_RE.exec(text)[1])
          : null,
      };
  }
  const els = [...root.querySelectorAll("button, div, span, p, a")].filter(
    (e) => {
      if (e.closest("[data-lens], .ss-trip")) return false;
      const t = (e.textContent || "").trim();
      return t.startsWith(NEAREST_CASE_LABEL) && nativeText(e).length < 320;
    },
  );
  if (!els.length) return null;
  const withHops = els.filter((e) => REGIONS_AWAY_RE.test(nativeText(e)));
  const pool = withHops.length ? withHops : els;
  const item = pool[pool.length - 1]; // document order lists ancestors first, so the last one is the deepest
  const text = nativeText(item);
  const m = REGIONS_AWAY_RE.exec(text);
  if (m) mapCache.set(root, item);
  return { item, text, hops: m ? Number(m[1]) : null };
}
