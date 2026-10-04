import * as dom from "./dom.mjs";
import { SCRAP_LADDER } from "./ladder.mjs";
import { quote, freshness } from "./quality.mjs";
import { fmt, signed, escapeHtml, ago } from "./format.mjs";
import { panel, setHtml, header, notice } from "./ui.mjs";
import { salesStats } from "./sales.mjs";
import {
  readStats,
  codeFor,
  summarizeOffers,
  statRanks,
  offerDimensions,
} from "./offers.mjs";
import {
  comparableFills,
  resaleEstimate,
  percentileRank,
  liquidity,
  MIN_RESALE_SAMPLE,
  MIN_PERCENTILE_PEERS,
} from "./resale.mjs";

const TAGS = {
  hit: "SNIPE",
  near: "NEAR MISS",
  miss: "ABOVE TARGET",
  unknown: "NO QUOTE",
  stale: "STALE",
  loading: "READING",
  error: "NO QUOTE",
};
const FULL_SCAN_EVERY = 30_000;

export function createEquipment({
  save,
  refresh,
  settings,
  requestSales,
  rescan = () => {},
  now = Date.now,
}) {
  let palette = dom.RARITY_PALETTE;
  let grid = null;
  let calibratedAt = 0;
  let previousRows = new Set();
  let pickerShowAll = false;
  let pickerTarget = null;
  let salesMemo = null;
  let salesComputed = null;
  let listRoot = null;
  let lastFullScan = 0;
  const rowCache = dom.createRowCache();
  const rowMemo = new WeakMap(); // annotation element -> the key of what it shows
  const openDetails = new Set(); // offer keys whose Details are open
  const resaleMemo = new Map();
  const metrics = {
    rowsScanned: 0,
    rowsWritten: 0,
    scopedScans: 0,
    fullScans: 0,
    get innerTextReads() {
      return rowCache.reads;
    },
    get styleReads() {
      return rowCache.styleReads;
    },
  };
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
    listRoot = null;
    openDetails.clear();
    removePicker();
  }
  /** One offer's identity across re-renders of the same list: item, price and its own numbers (a duplicate listing gets its ordinal). */
  const rowKey = (r) =>
    `${r.code ?? r.alt ?? ""}|${r.priceText ?? ""}|${r.stats.stat ?? ""}|${r.stats.durability ?? ""}`;
  function onAnnotationClick(e) {
    // Only our own controls catch a click: the Details button and the Details text (selectable). The rest of the
    // annotation, verdict, profit and resale, is the row's, in this handler as in the stylesheet (pointer-events).
    const button = e.target.closest?.("[data-action='details']");
    if (!button && !e.target.closest?.(".lens-details")) return;
    e.stopPropagation();
    if (!button) return;
    e.preventDefault();
    const key = e.currentTarget.dataset.ssKey;
    if (openDetails.has(key)) openDetails.delete(key);
    else openDetails.add(key);
    if (openDetails.size > 50)
      openDetails.delete(openDetails.values().next().value);
    rescan();
  }
  /**
   * Comparable-sales resale for one row, memoised per item, sales snapshot and
   * durability. The comparable fills travel with the estimate so the price
   * rank and the pace are read over the same sample as the median.
   */
  function resaleFor(code, sales, durability) {
    const anyState = sales.fills.some((f) => f?.state != null);
    const state = anyState ? durability : null;
    // The 72 h window is measured from now: a cached estimate turns over every five minutes so fills age out.
    const key = `${code}|${sales.at}|${state ?? "any"}|${Math.floor(now() / 300_000)}`;
    let est = resaleMemo.get(key);
    if (!est) {
      const fills = comparableFills(sales.fills, { code, now: now(), state });
      est = resaleEstimate(fills, {
        filter: false,
        now: now(),
        capped: !sales.complete,
        total: sales.fills.length,
      });
      est.fills = fills;
      est.durabilityCompared = anyState && durability != null;
      if (resaleMemo.size > 200) resaleMemo.clear();
      resaleMemo.set(key, est);
    }
    return est;
  }
  function resaleCell(dims, est, readFailed) {
    const kv = (b, small) =>
      `<span class="lens-kv"><b>${b}</b><small>${escapeHtml(small)}</small></span>`;
    // The last good read stays the evidence after a failed refresh, marked as such.
    const mark = readFailed ? " ⚠" : "";
    const failed = readFailed ? " · last read failed" : "";
    switch (dims.resale) {
      case "ok":
        return kv(
          `~${fmt(est.estimate)} g${mark}`,
          `resale · ${est.n} fills${failed}`,
        );
      case "insufficient":
        return kv(
          `–${mark}`,
          `resale · ${est.n} of ${MIN_RESALE_SAMPLE} fills${failed}`,
        );
      case "loading":
        return kv("…", "resale · reading sales");
      case "error":
        return kv("–", "resale · sales read failed");
      case "other-item":
        return kv("–", "resale · select this item");
      default:
        return kv("–", "resale · no comparable fills");
    }
  }
  function detailsHtml(
    r,
    { fresh, book, dims, est, rank, salesError, readFailed },
  ) {
    const lines = [];
    if (r.rarity)
      lines.push(
        `Dismantle: <b>${SCRAP_LADDER[r.rarity]}</b> scraps (${escapeHtml(r.rarity)}) × observed bids = <b>${fmt(r.q.value)} g</b>${r.q.complete ? " · bid depth covers it" : ` · only ${r.q.filled} covered by observed bids`}`,
      );
    else lines.push("Rarity unreadable: the frame border is off-palette");
    if (r.v.margin != null)
      lines.push(
        `Offer <b>${fmt(r.price)} g</b> · scrap covers ${r.v.coverPct.toFixed(0)}% of it · ${r.v.ratio.toFixed(2)}× its scrap floor`,
      );
    else if (r.price == null) lines.push("Price unreadable on this row");
    if (dims.resale === "ok") {
      lines.push(
        `Resale evidence: median <b>${fmt(est.estimate)} g</b> of ${est.n} comparable fills in ${est.windowHours} h${est.capped ? " (sample capped at five pages)" : ""} · low ${fmt(est.low)} · high ${fmt(est.high)}${est.quartiles ? ` · p25 ${fmt(est.p25)} · p75 ${fmt(est.p75)}` : ` · quartiles need ${MIN_PERCENTILE_PEERS} fills`}${est.uncertaintyPct != null ? ` · ±${est.uncertaintyPct.toFixed(0)}% spread (MAD)` : ""}`,
      );
      if (r.price != null)
        lines.push(
          `Resale − price = <b>${signed(est.estimate - r.price)} g</b> before market tax${rank?.status === "ok" ? ` · this price sits at the ${rank.percentile.toFixed(0)}th percentile of those fills` : ` · a price rank needs ${MIN_PERCENTILE_PEERS} fills`}`,
        );
      const liq = liquidity(est.fills, { now: now() });
      lines.push(
        `Pace: ${liq.perDay.toFixed(1)} fills/day${liq.medianGapHours != null ? ` · median gap ${liq.medianGapHours.toFixed(1)} h` : ""} · last fill ${escapeHtml(ago(est.lastAt, now()))} · ${est.durabilityCompared ? "comparables within ±10 durability" : "durability not compared"}`,
      );
    } else if (dims.resale === "insufficient")
      lines.push(
        `Resale: ${est.n} of ${MIN_RESALE_SAMPLE} comparable fills needed in the ${est.windowHours} h window${est.n ? ` (seen ${fmt(est.low)}–${fmt(est.high)} g)` : ""}${est.durabilityCompared ? " · comparables within ±10 durability" : ""}`,
      );
    else if (dims.resale === "error")
      lines.push(`Resale: sales read failed · ${escapeHtml(salesError ?? "")}`);
    else if (dims.resale === "loading")
      lines.push("Resale: reading recent sales…");
    else if (dims.resale === "other-item")
      lines.push("Resale: select this item in the grid to read its sales");
    else lines.push("Resale: no comparable fills in the window");
    if (readFailed && (dims.resale === "ok" || dims.resale === "insufficient"))
      lines.push(
        `Resale: last read failed · ${escapeHtml(readFailed)} · the last good read is shown`,
      );
    if (r.stats.readable)
      lines.push(
        `Durability ${r.stats.durability}% · stat ${r.stats.stat} · ${r.statRank?.status === "ok" ? `${r.statRank.percentile.toFixed(0)}th percentile among ${r.statRank.n} listed peers` : `stat rank needs ${MIN_PERCENTILE_PEERS} listed peers (${r.statRank?.n ?? 0} now)`}`,
      );
    else lines.push(`Stats unreadable: ${escapeHtml(r.stats.reason ?? "")}`);
    lines.push(
      `Quote ${book?.at ? escapeHtml(ago(book.at, now())) : "missing"} · ${fresh ? "fresh" : "not fresh: no action label"} · displayed price, no additional tax adjustment · read-only`,
    );
    return `<div class="lens-details" role="region" aria-label="Offer details">${lines.map((l) => `<span>${l}</span>`).join("")}</div>`;
  }
  function annotationHtml(r, kind, ctx) {
    const { open, best, dims, est } = ctx;
    const why =
      kind === "loading"
        ? "Reading scrap quote…"
        : kind === "error"
          ? "Quote unavailable"
          : !r.rarity
            ? "Rarity unreadable"
            : r.price == null
              ? "Price unreadable"
              : !r.q.complete
                ? "Insufficient observed bid depth"
                : "No quote";
    const scrap =
      r.v.margin == null
        ? `<span class="lens-kv"><b>–</b><small>${escapeHtml(why)}</small></span>`
        : `<span class="lens-kv"><b class="${r.v.margin >= 0 ? "lens-pos" : "lens-neg"}">${signed(r.v.margin)} g</b><small>scrap profit · ROI ${signed(r.v.marginPct * 100, 1)}%</small></span>`;
    return `<span class="lens-tag">${TAGS[kind]}</span>${scrap}${resaleCell(dims, est, ctx.readFailed)}${best ? '<span class="lens-muted lens-best">Best value</span>' : ""}<button type="button" data-action="details" aria-expanded="${open}" aria-label="${open ? "Hide" : "Show"} details for this offer">${open ? "Hide" : "Details"}</button>${open ? detailsHtml(r, ctx) : ""}`;
  }
  function render(state) {
    // A scoped scan is trusted only when it finds a list (two rows or more);
    // one row says nothing about where the next ones will be inserted.
    const periodic = now() - lastFullScan >= FULL_SCAN_EVERY;
    if (periodic) rowCache.epoch++; // frames and borders are re-read on the periodic full scan
    const scoped =
      listRoot?.isConnected && !periodic
        ? dom.offerRows(listRoot, palette, rowCache)
        : [];
    let rows = scoped;
    if (scoped.length >= 2) metrics.scopedScans++;
    else {
      rows = dom.offerRows(document, palette, rowCache);
      metrics.fullScans++;
      lastFullScan = now();
    }
    listRoot = dom.rowsContainer(rows) ?? (rows.length >= 2 ? listRoot : null);
    metrics.rowsScanned += rows.length;
    const frames = dom.gridFrames();
    const nextGrid = frames[0]?.frame;
    if (grid !== nextGrid || now() - calibratedAt > 30_000) {
      grid = nextGrid;
      const live = dom.calibrateRarityBorders();
      palette = dom.withFallbackPalette(live);
      calibratedAt = now();
    }
    const code =
      dom.selectedItemCode() ?? dom.filteredItemCode(location.search);
    const s = settings();
    if (code) requestSales(code);
    const anchor = dom.marketAnchor();
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
    const book = state.book;
    const fresh =
      !state.error && freshness(book?.at, s.intervalSec * 1000) === "fresh";
    const loading = !book && !!state.busy;
    const setup = state.setup;
    const salesByCode = state.salesByCode ?? {};
    const salesFor = (c) =>
      (c && salesByCode[c]) ||
      (c && state.sales?.code === c ? state.sales : null);
    // Errors and the read in flight are per item; the old single flags stay as the fallback.
    const salesErrorFor = (c) =>
      state.salesErrors
        ? (state.salesErrors[c] ?? null)
        : c === code
          ? (state.salesError ?? null)
          : null;
    const salesReadingFor = (c) =>
      state.salesReading != null ? state.salesReading === c : !!state.salesBusy;
    const valuations = rows.map((r) => {
      // Trust the row first; a just-changed grid selection can precede replacement of the list.
      const rarity =
        dom.rarityFromBorder(r.border, palette) ??
        dom.rarityFromItemCode(r.alt);
      const slot = dom.slotFromAlt(r.alt);
      const rowCode =
        codeFor(slot, rarity) ?? (dom.rarityFromItemCode(r.alt) ? r.alt : null);
      const stats = readStats(r.lines);
      const q = rarity
        ? quote(SCRAP_LADDER[rarity], book?.bids)
        : { value: null, complete: false, filled: 0 };
      const v = dom.verdict({
        price: r.price,
        floor: q.value,
        minMarginPct: s.minMarginPct,
      });
      const sales = salesFor(rowCode);
      const resale = sales ? resaleFor(rowCode, sales, stats.durability) : null;
      return { ...r, rarity, slot, code: rowCode, stats, q, v, sales, resale };
    });
    const ranks = statRanks(valuations);
    const best = dom.closestIndex(valuations.map((r) => r.v));
    const current = new Set(rows.map((r) => r.row));
    for (const row of previousRows)
      if (!current.has(row)) {
        row.querySelector(":scope > .ss-verdict")?.remove();
        delete row.dataset.scrapSniper;
      }
    const dupes = new Map();
    for (const [i, r] of valuations.entries()) {
      if (setup) {
        r.row.querySelector(":scope > .ss-verdict")?.remove();
        delete r.row.dataset.scrapSniper;
        continue;
      }
      const kind = loading
        ? "loading"
        : !book && state.error
          ? "error"
          : !fresh
            ? "stale"
            : r.v.hit == null
              ? "unknown"
              : r.v.hit
                ? "hit"
                : r.v.near
                  ? "near"
                  : "miss";
      r.statRank = ranks[i];
      const base = rowKey(r);
      const ordinal = dupes.get(base) ?? 0;
      dupes.set(base, ordinal + 1);
      const key = ordinal ? `${base}#${ordinal}` : base;
      const open = openDetails.has(key);
      const ownItem = r.code != null && (r.sales != null || r.code === code);
      const dims = offerDimensions({
        stats: r.stats,
        hasQuote: !!book,
        fresh,
        error: state.error,
        salesError: ownItem && !r.sales ? salesErrorFor(r.code) : null,
        salesLoading: ownItem && !r.sales && salesReadingFor(r.code),
        resale: r.resale,
        ownItem,
      });
      const rank =
        dims.resale === "ok" && r.price != null
          ? percentileRank(
              r.price,
              r.resale.fills.map((f) => f.price),
            )
          : null;
      let el = r.row.querySelector(":scope > .ss-verdict");
      if (!el) {
        el = document.createElement("div");
        el.className = "ss-verdict";
        el.dataset.lens = "";
        el.addEventListener("click", onAnnotationClick);
        r.row.appendChild(el);
      }
      if (r.row.dataset.scrapSniper !== kind) r.row.dataset.scrapSniper = kind;
      el.dataset.ssKey = key;
      const memo = [
        kind,
        book?.at ?? "",
        s.minMarginPct,
        r.sales?.at ?? "",
        dims.resale,
        // the estimate itself: a fill ageing out of the window changes the count or the median without changing the status
        r.resale
          ? `${r.resale.n}|${r.resale.estimate ?? ""}|${r.resale.low ?? ""}|${r.resale.high ?? ""}|${r.resale.quartiles}`
          : "",
        // the peer count as well as the rank: below eight peers the rank stays null while the count Details shows moves
        r.statRank ? `${r.statRank.n}|${r.statRank.percentile ?? ""}` : "",
        open,
        i === best && fresh,
        key,
        salesErrorFor(r.code) ?? "", // a failed refresh marks the row, open or not
        open ? Math.floor(now() / 60000) : "",
      ].join("|");
      if (rowMemo.get(el) === memo) continue;
      rowMemo.set(el, memo);
      metrics.rowsWritten++;
      setHtml(
        el,
        annotationHtml(r, kind, {
          open,
          best: i === best && fresh,
          dims,
          est: r.resale,
          fresh,
          book,
          rank,
          salesError: salesErrorFor(r.code),
          readFailed: ownItem && r.sales ? salesErrorFor(r.code) : null,
        }),
      );
    }
    previousRows = current;
    if (!setup) picker(code, s.picker);
    else removePicker();
    const summary = summarizeOffers(valuations);
    const hits = fresh ? valuations.filter((r) => r.v.hit).length : 0;
    const profitable = fresh
      ? valuations.filter((r) => r.v.margin != null && r.v.margin >= 0).length
      : 0;
    const floors = dom.RARITIES.map(
      (r) =>
        `<div><span>${r}</span><b>${fmt(quote(SCRAP_LADDER[r], book?.bids).value)}</b></div>`,
    ).join("");
    const selectedSales = salesFor(code);
    const memoKey = `${selectedSales?.at}:${code}:${Math.floor(now() / 60000)}`;
    if (memoKey !== salesMemo) {
      salesMemo = memoKey;
      salesComputed = selectedSales
        ? salesStats(selectedSales.fills, { now: now() })
        : null;
    }
    const sales = salesComputed;
    const selectedEst =
      selectedSales && code ? resaleFor(code, selectedSales, null) : null;
    const selectedError = salesErrorFor(code);
    const resaleSummary = !code
      ? "select an item"
      : selectedError && !selectedSales
        ? "sales read failed"
        : selectedEst?.status === "ok"
          ? `${selectedEst.n} fills · median ${fmt(selectedEst.estimate)} g${selectedError ? " ⚠ last read failed" : ""}`
          : selectedEst
            ? `${selectedEst.n} of ${MIN_RESALE_SAMPLE} fills${selectedError ? " ⚠ last read failed" : ""}`
            : salesReadingFor(code)
              ? "reading…"
              : "no sales yet";
    const salesLine = selectedError
      ? `<p class="lens-notice" role="status">Sales: ${escapeHtml(selectedError)}${selectedSales ? ` · showing the last good read from ${escapeHtml(ago(selectedSales.at, now()))}` : ""}</p>`
      : sales
        ? `<p class="lens-muted">${sales.count} sales of ${escapeHtml(dom.itemLabel(code))} · median ${fmt(sales.median)} g · low ${fmt(sales.low)} · high ${fmt(sales.high)}${selectedSales.complete ? " · 72h window" : " · capped sample, not the full 72h"}</p>`
        : '<p class="lens-muted">Select an item for recent sales.</p>';
    setHtml(
      bar,
      header("Equipment", {
        at: book?.at,
        status: setup
          ? "setup"
          : loading
            ? "loading"
            : fresh
              ? "fresh"
              : "stale",
        collapsed: s.collapsed,
        busy: !!state.busy,
      }) +
        (setup
          ? notice(setup, state.invalidated)
          : `<div class="lens-summary"><strong>${hits} snipes</strong><span>${profitable} non-loss / ${summary.scanned} scanned</span><span>${summary.readable} readable stats</span><span>Resale: ${escapeHtml(resaleSummary)}</span><span>Minimum ROI ${s.minMarginPct}%</span><button type="button" data-action="margin-down" aria-label="Lower minimum ROI">−5</button><button type="button" data-action="margin-up" aria-label="Raise minimum ROI">+5</button></div>${state.error ? `<p class="lens-notice" role="status">${escapeHtml(state.error)}${book ? " · showing the last quote" : ""}</p>` : ""}<div ${s.collapsed ? "hidden" : ""}><div class="lens-floors">${floors}</div>${salesLine}<p class="lens-muted">Scrap profit values the dismantle through observed bids, depth-adjusted; resale is the median of comparable completed sales (${MIN_RESALE_SAMPLE} needed, ${MIN_PERCENTILE_PEERS} for ranks). Quotes are snapshots, not reserved liquidity. Displayed purchase price; no additional tax adjustment.</p></div>`),
    );
    return {
      roots: [
        anchor.parentElement,
        listRoot,
        ...new Set(rows.map((r) => r.row.parentElement)),
      ].filter(Boolean),
      code,
      count: rows.length,
    };
  }
  return { render, clear, metrics };
}
