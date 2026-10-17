// The game's sell form ("+ NEW ITEM OFFER"): which pieces are picked, the
// game's own estimate and the range it allows, and one line of ours under
// PRICE with a suggested price (pricing.mjs) and a Use button that writes it
// into the game's input. Nothing is listed: PUT ON SALE stays the player's.
import { gold, escapeHtml as esc } from "./format.mjs";
import { setHtml } from "./ui.mjs";
import {
  slotFromAlt,
  isItemImageAlt,
  slotName,
  auctionTokens,
} from "./dom.mjs";
import { tileTokens, tileStats, tileCode } from "./picker.mjs";
import { rowSkills } from "./similar.mjs";

const NUMBER = /^[\d,]+(?:\.\d+)?$/;
const num = (/** @type {string} */ t) => Number(t.replace(/,/g, ""));
/** Pieces whose prices differ more than this are not sold at one price. */
const SPREAD = 0.15;

/** The open sell form: a dialog that starts "Sell an item" and holds the price input. */
export function findSellForm(root = document) {
  return (
    [...root.querySelectorAll('[role="dialog"]')].find(
      (d) =>
        /^\s*sell an item/i.test(d.textContent ?? "") &&
        !!d.querySelector('input[name="price"]'),
    ) ?? null
  );
}

/** The gradient-backed box around an item image (the game draws every tile that way). */
function tileOf(img, stop) {
  for (let e = img; e && e !== stop; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (s.backgroundImage && s.backgroundImage !== "none") return e;
  }
  return null;
}

/**
 * The picked pieces (code, stats), the price input, and the game's numbers:
 * its "Market average", its "Suggested price" and the range around it.
 * @param {Element} form
 */
/**
 * The pieces picked in a form: each tile that prints its stats, as its code, stats and skills (a tile without
 * stats, such as the auction form's summary image, is not a piece).
 * @param {Element} form
 */
function pickedItems(form) {
  const items = [];
  for (const img of form.querySelectorAll("img")) {
    const alt = img.getAttribute("alt");
    if (!isItemImageAlt(alt)) continue;
    const tile = tileOf(img, form);
    const read = tile ? tileStats(tileTokens(tile)) : null;
    const code = read ? tileCode(slotFromAlt(alt), read.stats) : null;
    if (!code || !read) continue;
    items.push({
      code,
      stats: read.stats,
      skills: rowSkills(code, read.stats),
    });
  }
  return items;
}

export function readSellForm(form) {
  const input = /** @type {HTMLInputElement | null} */ (
    form.querySelector('input[name="price"]')
  );
  const items = pickedItems(form);
  const tokens = tileTokens(form);
  const after = (/** @type {RegExp} */ re) => {
    const i = tokens.findIndex((t) => re.test(t));
    return i >= 0 && NUMBER.test(tokens[i + 1] ?? "")
      ? num(tokens[i + 1])
      : null;
  };
  // the numbers between "Suggested price" and "You receive": the suggestion, then the range's ends
  const from = tokens.findIndex((t) => /^suggested price$/i.test(t));
  const to = tokens.findIndex((t, i) => i > from && /^you receive$/i.test(t));
  const range = (
    from >= 0 ? tokens.slice(from + 1, to > from ? to : undefined) : []
  )
    .filter((t) => NUMBER.test(t))
    .map(num);
  return {
    form,
    input,
    items,
    game: {
      average: after(/^market average$/i),
      suggested: range[0] ?? null,
      min: range.length ? Math.min(...range) : null,
      max: range.length ? Math.max(...range) : null,
    },
  };
}

const ageWords = (/** @type {number | null} */ m) =>
  m == null
    ? ""
    : m < 60
      ? `${m} min`
      : m < 1440
        ? `${Math.round(m / 60)} h`
        : `${Math.round(m / 1440)} d`;
const priceText = (/** @type {number} */ v) =>
  String(Math.round(v * 1000) / 1000);

/**
 * Our line under PRICE for the picked pieces (each { code, s } with s from
 * suggestPrice). One piece: its price, why, and what it rests on. Several:
 * one price for all when they are close (the lowest), else each piece's
 * price and no Use, since one price would sell the dearer ones cheap.
 * `noKey`: no API key to read sales with, so the price rests on the asks.
 * @param {Array<{ code: string, noKey?: boolean, s: ReturnType<typeof import("./pricing.mjs").suggestPrice> }>} picks
 */
export function sellHintHtml(picks) {
  const priced = picks.filter((p) => p.s?.price != null);
  if (!priced.length || picks.some((p) => !p.s))
    return `<span class="lens-brand">◈</span> <span class="lens-muted">reading the sales of these stats…</span>`;
  const prices = priced.map((p) => /** @type {number} */ (p.s.price));
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  if (priced.length > 1 && hi > lo * (1 + SPREAD))
    return `<span class="lens-brand">◈</span> <span class="lens-neg">list apart:</span> ${priced
      .map((p) => `${esc(slotName(p.code))} ${gold(p.s.price)}`)
      .join(" · ")}`;
  const one = priced.length === 1 ? priced[0].s : null;
  const use = `<button type="button" data-sell-use="${priceText(lo)}" title="write this price into the form; nothing is listed until you press PUT ON SALE">use</button>`;
  const basis = one
    ? [
        one.sold.value != null
          ? `sold ${gold(one.sold.value)} · ${esc(one.sold.label)}`
          : priced[0].noKey
            ? `<span class="lens-muted">sales need your API key</span>`
            : "",
        one.floor
          ? `${one.floor.better ? "better ask" : "ask"} ${gold(one.floor.price)} · ${ageWords(one.floor.ageMin)}`
          : "",
        one.rising
          ? `<span class="lens-pos">rising${one.trend != null ? ` ${one.trend >= 0 ? "+" : "−"}${Math.round(Math.abs(one.trend) * 100)}% vs week` : ""}</span>`
          : "",
        one.clamped
          ? `<span class="lens-muted">kept in the game's range</span>`
          : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : `${priced.length} pieces, the lowest of their prices`;
  return `<div><span class="lens-brand">◈</span> <b>${priceText(lo)}</b> <small>${one ? esc(one.why) : "for all"}</small> ${use}</div>${basis ? `<small>${basis}</small>` : ""}`;
}

/** Write `value` into the game's input the way typing would: the prototype's setter, then an input event. */
function typeInto(/** @type {HTMLInputElement} */ input, value) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * v0.27's Start an auction form: a dialog with the start price and the max
 * price inputs, found by their names (the labels are translated). Nothing is
 * listed from here: START AUCTION stays the player's.
 */
export function findAuctionForm(root = document) {
  return (
    [...root.querySelectorAll('[role="dialog"]')].find(
      (d) =>
        !!d.querySelector('input[name="startPrice"]') &&
        !!d.querySelector('input[name="maxPrice"]'),
    ) ?? null
  );
}

/**
 * The picked pieces, the two inputs, and the range the game prints for the
 * max price of one piece ("From 82.404 to 131.846": two amounts with one
 * word between them, the second 1.6 times the first; null when the form does
 * not print it, as with several pieces, where the max is a percentage). The
 * page prints decimals in pieces ("131", ".", "846"), read as one number;
 * the start slider's numbers stand side by side and are no range.
 * @param {Element} form
 */
export function readAuctionForm(form) {
  const start = /** @type {HTMLInputElement} */ (
    form.querySelector('input[name="startPrice"]')
  );
  const max = /** @type {HTMLInputElement} */ (
    form.querySelector('input[name="maxPrice"]')
  );
  const tokens = auctionTokens(form);
  let range = null;
  for (let i = 0; i + 2 < tokens.length && !range; i++) {
    if (
      !NUMBER.test(tokens[i]) ||
      NUMBER.test(tokens[i + 1]) ||
      !NUMBER.test(tokens[i + 2])
    )
      continue;
    const lo = num(tokens[i]);
    const hi = num(tokens[i + 2]);
    if (lo > 0 && Math.abs(hi / lo - 1.6) <= 0.002) range = { lo, hi };
  }
  return { form, start, max, items: pickedItems(form), range };
}

/**
 * Our line under the max price: a start and a max for one piece (from
 * pricing.suggestAuction) and Use; with several pieces picked, a note.
 * @param {{ count: number, noKey?: boolean, s: ReturnType<typeof import("./pricing.mjs").suggestAuction> | null }} input
 */
export function auctionHintHtml({ count, noKey = false, s }) {
  if (count > 1)
    return `<span class="lens-brand">◈</span> <span class="lens-muted">pick one piece for a start and max price</span>`;
  if (!s || s.max == null)
    return `<span class="lens-brand">◈</span> <span class="lens-muted">${s ? "no estimate for this piece yet" : "reading the sales of these stats…"}</span>`;
  const use = `<button type="button" data-auction-use data-start="${priceText(s.start)}" data-max="${priceText(s.max)}" title="write both prices into the form; nothing is listed until you press START AUCTION">use</button>`;
  const basis = [
    s.sold.value != null
      ? `sold ${gold(s.sold.value)} · ${esc(s.sold.label)}`
      : noKey
        ? `<span class="lens-muted">sales need your API key</span>`
        : "",
    s.est != null ? `estimate ${gold(s.est)}` : "",
    s.clamped ? `<span class="lens-muted">kept in the game's range</span>` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const startTitle =
    "what its scraps fetch at the bids: a lone bidder never takes it for less than dismantling gives";
  return `<div><span class="lens-brand">◈</span> <span title="${startTitle}">start <b>${priceText(s.start)}</b></span> · max <b>${priceText(s.max)}</b> <small>${esc(s.why)}</small> ${use}</div>${basis ? `<small>${basis}</small>` : ""}`;
}

/**
 * Show `html` under the form's max price (one element, reused), and wire Use to write both prices into the
 * game's inputs the way typing would.
 * @param {ReturnType<typeof readAuctionForm>} read @param {string} html
 */
export function renderAuctionHint(read, html) {
  const after = read.max?.closest("label") ?? read.max?.parentElement;
  if (!after) return;
  let el = /** @type {HTMLElement | null} */ (
    read.form.querySelector(".ss-auction")
  );
  if (!el) {
    el = document.createElement("div");
    el.className = "ss-sell ss-auction";
    el.dataset.lens = "";
    el.addEventListener("click", (e) => {
      const b = /** @type {HTMLElement | null} */ (
        /** @type {Element} */ (e.target).closest("[data-auction-use]")
      );
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      const form = /** @type {Element} */ (el?.closest('[role="dialog"]'));
      const start = /** @type {HTMLInputElement | null} */ (
        form?.querySelector('input[name="startPrice"]')
      );
      const max = /** @type {HTMLInputElement | null} */ (
        form?.querySelector('input[name="maxPrice"]')
      );
      if (start) typeInto(start, b.dataset.start ?? "");
      if (max) typeInto(max, b.dataset.max ?? "");
    });
  }
  if (after.nextElementSibling !== el)
    after.insertAdjacentElement("afterend", el);
  setHtml(el, html);
}

/**
 * Show `html` under the form's PRICE label (one element, reused), and wire
 * Use to write its price into the game's input the way typing would.
 * @param {ReturnType<typeof readSellForm>} read @param {string} html
 */
export function renderSellHint(read, html) {
  const label = read.input?.closest("label");
  if (!label) return;
  let el = /** @type {HTMLElement | null} */ (
    read.form.querySelector(".ss-sell")
  );
  if (!el) {
    el = document.createElement("div");
    el.className = "ss-sell";
    el.dataset.lens = "";
    el.addEventListener("click", (e) => {
      const b = /** @type {HTMLElement | null} */ (
        /** @type {Element} */ (e.target).closest("[data-sell-use]")
      );
      if (!b || !read.input) return;
      e.preventDefault();
      e.stopPropagation();
      // the prototype's setter, then an input event: the game's form sees a typed value
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(read.input),
        "value",
      )?.set;
      setter?.call(read.input, b.dataset.sellUse ?? "");
      read.input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  if (label.nextElementSibling !== el)
    label.insertAdjacentElement("afterend", el);
  setHtml(el, html);
}
