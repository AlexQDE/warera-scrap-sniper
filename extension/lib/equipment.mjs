import * as dom from "./dom.mjs";
import { SCRAP_LADDER } from "./ladder.mjs";
import { quote, freshness } from "./quality.mjs";
import { fmt, signed, escapeHtml } from "./format.mjs";
import { panel, setHtml, header, notice } from "./ui.mjs";
import { salesStats } from "./sales.mjs";

export function createEquipment({ save, refresh, settings, requestSales }) {
  let palette = dom.RARITY_PALETTE;
  let grid = null;
  let calibratedAt = 0;
  let previousRows = new Set();
  let pickerShowAll = false;
  let pickerTarget = null;
  let salesMemo = null;
  let salesComputed = null;
  const removePicker = () => {
    document.querySelector(".ss-pick-bar")?.remove();
    for (const el of document.querySelectorAll(
      "[data-ss-pick], [data-ss-wide]",
    )) {
      delete el.dataset.ssPick;
      delete el.dataset.ssWide;
    }
    pickerTarget = null;
    pickerShowAll = false;
  };
  function picker(code, enabled) {
    const dialog = dom.pickerDialog();
    const target = dom.targetFromCode(code);
    if (!dialog || !target || !enabled) {
      removePicker();
      return;
    }
    if (pickerTarget !== code) {
      pickerTarget = code;
      pickerShowAll = false;
    }
    const tiles = dom.pickerTiles(dialog, palette);
    const matches = tiles.filter(
      (t) => dom.pickerDecision(t, target) === "show",
    ).length;
    for (const t of tiles) {
      const want =
        !pickerShowAll && matches && dom.pickerDecision(t, target) === "hide"
          ? "hide"
          : "show";
      if (t.cell.dataset.ssPick !== want) t.cell.dataset.ssPick = want;
    }
    let bar = dialog.querySelector(".ss-pick-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "ss-pick-bar";
      bar.dataset.lens = "";
      bar.addEventListener("click", (e) => {
        if (e.target.closest("[data-picker-toggle]")) {
          pickerShowAll = !pickerShowAll;
          picker(pickerTarget, true);
        }
      });
      dom.pickerCard(dialog).prepend(bar);
    }
    setHtml(
      bar,
      `<span>${matches ? `${matches} matching ${escapeHtml(dom.itemLabel(code))} · ${tiles.length} total` : "No matches recognized; nothing hidden"}</span><button type="button" data-picker-toggle>${pickerShowAll ? "Filter items" : "Show all"}</button>`,
    );
  }
  function clear() {
    document.getElementById("scrap-sniper-bar")?.remove();
    for (const row of previousRows) {
      row.querySelector(":scope > .ss-verdict")?.remove();
      delete row.dataset.scrapSniper;
    }
    previousRows.clear();
    grid = null;
    removePicker();
  }
  function render(state) {
    const rows = dom.offerRows(document, palette);
    const frames = dom.gridFrames();
    const nextGrid = frames[0]?.frame;
    if (grid !== nextGrid || Date.now() - calibratedAt > 30_000) {
      grid = nextGrid;
      const live = dom.calibrateRarityBorders();
      palette = dom.withFallbackPalette(live);
      calibratedAt = Date.now();
    }
    const code =
      dom.selectedItemCode() ?? dom.filteredItemCode(location.search);
    const s = settings();
    if (code && !s.collapsed) requestSales(code);
    const anchor = dom.taxNotice() ?? nextGrid?.parentElement?.parentElement;
    if (!anchor) {
      clear();
      return;
    }
    const bar = panel("scrap-sniper-bar", anchor, (e) => {
      const action = e.target.closest("[data-action]")?.dataset.action;
      if (action === "refresh") refresh();
      if (action === "collapse") save({ collapsed: !settings().collapsed });
      if (action === "margin-up")
        save({ minMarginPct: settings().minMarginPct + 5 });
      if (action === "margin-down")
        save({ minMarginPct: settings().minMarginPct - 5 });
      if (action === "settings" || action === "reload") state.action(action);
    });
    const fresh =
      !state.error &&
      freshness(state.book?.at, s.intervalSec * 1000) === "fresh";
    const setup = state.setup;
    const valuations = rows.map((r) => {
      // Trust the row first; a just-changed grid selection can precede replacement of the list.
      const rarity =
        dom.rarityFromBorder(r.border, palette) ??
        dom.rarityFromItemCode(r.img?.getAttribute("alt"));
      const q = rarity
        ? quote(SCRAP_LADDER[rarity], state.book?.bids)
        : { value: null, complete: false };
      const v = dom.verdict({
        price: r.price,
        floor: q.value,
        minMarginPct: s.minMarginPct,
      });
      return { ...r, rarity, q, v };
    });
    const best = dom.closestIndex(valuations.map((r) => r.v));
    const current = new Set(rows.map((r) => r.row));
    for (const row of previousRows)
      if (!current.has(row)) {
        row.querySelector(":scope > .ss-verdict")?.remove();
        delete row.dataset.scrapSniper;
      }
    for (const [i, r] of valuations.entries()) {
      if (setup) {
        r.row.querySelector(":scope > .ss-verdict")?.remove();
        delete r.row.dataset.scrapSniper;
        continue;
      }
      const kind = !fresh
        ? "stale"
        : r.v.hit == null
          ? "unknown"
          : r.v.hit
            ? "hit"
            : r.v.near
              ? "near"
              : "miss";
      const tag =
        kind === "hit"
          ? "SNIPE"
          : kind === "near"
            ? "NEAR MISS"
            : kind === "stale"
              ? "STALE"
              : kind === "unknown"
                ? "NO QUOTE"
                : "ABOVE TARGET";
      let el = r.row.querySelector(":scope > .ss-verdict");
      if (!el) {
        el = document.createElement("div");
        el.className = "ss-verdict";
        el.dataset.lens = "";
        r.row.appendChild(el);
      }
      if (r.row.dataset.scrapSniper !== kind) r.row.dataset.scrapSniper = kind;
      const why = !r.rarity
        ? "Rarity unreadable"
        : r.price == null
          ? "Price unreadable"
          : !r.q.complete
            ? "Insufficient observed bid depth"
            : `Scrap snapshot ${fmt(r.q.value)} g · ROI ${signed(r.v.marginPct * 100, 1)}%`;
      setHtml(
        el,
        `<span class="lens-tag">${tag}</span><strong>${r.v.margin == null ? "–" : `${signed(r.v.margin)} g`}</strong>${i === best && fresh ? '<span class="lens-muted">Best value</span>' : ""}<span class="lens-muted">${escapeHtml(why)}</span>`,
      );
    }
    previousRows = current;
    if (!setup) picker(code, s.picker);
    else removePicker();
    const hits = fresh ? valuations.filter((r) => r.v.hit).length : 0;
    const profitable = fresh
      ? valuations.filter((r) => r.v.margin != null && r.v.margin >= 0).length
      : 0;
    const floors = dom.RARITIES.map(
      (r) =>
        `<div><span>${r}</span><b>${fmt(quote(SCRAP_LADDER[r], state.book?.bids).value)}</b></div>`,
    ).join("");
    const memoKey = `${state.sales?.at}:${code}:${Math.floor(Date.now() / 60000)}`;
    if (memoKey !== salesMemo) {
      salesMemo = memoKey;
      salesComputed =
        state.sales?.code === code ? salesStats(state.sales.fills) : null;
    }
    const sales = salesComputed;
    const salesLine = state.salesError
      ? `<p class="lens-notice">Sales: ${escapeHtml(state.salesError)}</p>`
      : sales
        ? `<p class="lens-muted">${sales.count} sales · median ${fmt(sales.median)} g · low ${fmt(sales.low)} · high ${fmt(sales.high)}${state.sales.complete ? " · 72h window" : " · capped sample, not the full 72h"}</p>`
        : '<p class="lens-muted">Select an item for recent sales.</p>';
    setHtml(
      bar,
      header("Equipment", {
        at: state.book?.at,
        status: setup ? "setup" : fresh ? "fresh" : "stale",
        collapsed: s.collapsed,
        busy: state.busy,
      }) +
        (setup
          ? notice(setup, state.invalidated)
          : `<div class="lens-summary"><strong>${hits} matches</strong><span>${profitable} non-loss offers / ${rows.length} scanned</span><span>Minimum ROI ${s.minMarginPct}%</span><button type="button" data-action="margin-down" aria-label="Lower minimum ROI">−5</button><button type="button" data-action="margin-up" aria-label="Raise minimum ROI">+5</button></div>${state.error ? `<p class="lens-notice">${escapeHtml(state.error)}</p>` : ""}<div ${s.collapsed ? "hidden" : ""}><div class="lens-floors">${floors}</div>${salesLine}<p class="lens-muted">Observed bids, depth-adjusted. Quotes are snapshots, not reserved liquidity. Displayed purchase price; no additional tax adjustment.</p></div>`),
    );
    return {
      roots: [
        anchor.parentElement,
        ...new Set(rows.map((r) => r.row.parentElement)),
      ].filter(Boolean),
      code,
      count: rows.length,
    };
  }
  return { render, clear };
}
