// The equipment market: one verdict line on every offer row (scrap profit
// against the observed bids, the value the piece sells for, a tag), the
// picker filter, and the Market section of the bar (scrap floors, the
// selected item's recent fills). Reading and rendering only; the maths live
// in quality.mjs (depth quotes), dom.mjs (verdict), resale.mjs (fills) and
// observed.mjs (what a roll clears at).
import * as dom from "./dom.mjs";
import { SCRAP_LADDER } from "./ladder.mjs";
import { quote, freshness, TTL, positive } from "./quality.mjs";
import { fmt, signed, escapeHtml, ago } from "./format.mjs";
import { setHtml, timeLabel } from "./ui.mjs";
import { salesStats } from "./sales.mjs";
import { readStats, codeFor, summarizeOffers, statRanks } from "./offers.mjs";
import { comparableFills, percentileRank, liquidity } from "./resale.mjs";
import { rollValue, MIN_ROLL_SAMPLE } from "./observed.mjs";
import { keyStat } from "./stats.mjs";
import { WEAPONS } from "./items.mjs";

export const TAGS = {
  hit: "SNIPE",
  flip: "FLIP",
  near: "NEAR MISS",
  miss: "PASS",
  unknown: "NO QUOTE",
  stale: "STALE",
  loading: "READING",
  error: "NO QUOTE",
};
const FULL_SCAN_EVERY = 30_000;
const BASIS_WORDS = {
  roll: "same-roll fills",
  band: "fills in the roll's band",
  item: "fills, any roll",
};

/** The roll a row prints, keyed the way fills carry it: the slot's stat, or a weapon's attack (its crit is not read). */
export function rowSkills(code, stats) {
  if (!code || stats?.stat == null) return null;
  const stat = WEAPONS.includes(code) ? "attack" : keyStat(code);
  return stat ? { [stat]: stats.stat } : null;
}

/**
 * What the piece sells for: the median of recent fills of the same roll, of
 * its band, of the item (five each, 72 h), else the game's average price
 * for the code. null when neither is known.
 */
export function valueOf({ code, stats, sales, avg, avgAt, now }) {
  if (sales?.fills) {
    const fills = comparableFills(sales.fills, { code, now, state: null });
    const v = rollValue(code, rowSkills(code, stats), fills);
    if (v.value != null)
      return {
        amount: v.value,
        source: "fills",
        basis: v.level,
        n: v.n,
        label: `${v.n} ${BASIS_WORDS[v.level]}`,
      };
  }
  const a = positive(avg);
  if (a != null) {
    const f = freshness(avgAt ?? null, TTL.avg, now);
    return {
      amount: a,
      source: "avg",
      basis: "avg",
      n: 0,
      label: `game avg${f === "fresh" ? "" : " (stale)"}`,
    };
  }
  return null;
}

export function createEquipment({
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
  let listRoot = null;
  let lastFullScan = 0;
  let last = { hits: 0, flips: 0, scanned: 0, readable: 0, code: null };
  const rowCache = dom.createRowCache();
  const rowMemo = new WeakMap(); // annotation element -> the key of what it shows
  const openDetails = new Set(); // offer keys whose Details are open
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
    for (const row of previousRows) {
      row.querySelector(":scope > .ss-verdict")?.remove();
      delete row.dataset.scrapSniper;
    }
    previousRows.clear();
    grid = null;
    listRoot = null;
    openDetails.clear();
    removePicker();
    last = { hits: 0, flips: 0, scanned: 0, readable: 0, code: null };
  }
  /** One offer's identity across re-renders of the same list: item, price and its own numbers (a duplicate listing gets its ordinal). */
  const rowKey = (r) =>
    `${r.code ?? r.alt ?? ""}|${r.priceText ?? ""}|${r.stats.stat ?? ""}|${r.stats.durability ?? ""}`;
  function onAnnotationClick(e) {
    // Only our own controls catch a click: the Details button and the Details text (selectable). The rest of the
    // annotation is the row's, in this handler as in the stylesheet (pointer-events).
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
  function detailsHtml(r, { fresh, book, value, rank, salesState }) {
    const lines = [];
    if (r.rarity)
      lines.push(
        `Dismantle: <b>${SCRAP_LADDER[r.rarity]}</b> scraps (${escapeHtml(r.rarity)}) at the observed bids = <b>${fmt(r.q.value)} g</b>${r.q.complete ? "" : ` · only ${r.q.filled} covered by observed bids`}`,
      );
    else lines.push("Rarity unreadable: the frame border is off-palette");
    if (r.v.margin != null)
      lines.push(
        `Offer <b>${fmt(r.price)} g</b> · scrap covers ${r.v.coverPct.toFixed(0)}% of it · ${r.v.ratio.toFixed(2)}× its scrap floor`,
      );
    else if (r.price == null) lines.push("Price unreadable on this row");
    if (value) {
      const gap = r.price != null ? value.amount - r.price : null;
      lines.push(
        `Value <b>${fmt(value.amount)} g</b> · ${escapeHtml(value.label)}${gap != null ? ` · value − price = <b>${signed(gap)} g</b> (${signed((gap / r.price) * 100, 1)}%)` : ""}`,
      );
      if (value.source === "fills" && r.sales) {
        const fills = comparableFills(r.sales.fills, {
          code: r.code,
          now: now(),
          state: null,
        });
        const liq = liquidity(fills, { now: now() });
        lines.push(
          `${fills.length} fills of ${escapeHtml(dom.itemLabel(r.code))} in 72 h${r.sales.complete ? "" : " (sample capped)"} · pace ${liq.perDay.toFixed(1)}/day${liq.medianGapHours != null ? ` · median gap ${liq.medianGapHours.toFixed(1)} h` : ""} · last ${escapeHtml(ago(liq.lastAt, now()))}${rank?.status === "ok" ? ` · this price sits at the ${rank.percentile.toFixed(0)}th percentile of those fills` : ""}`,
        );
      } else if (value.source === "avg")
        lines.push(
          `The game's average is a mean of recent sales of ${escapeHtml(dom.itemLabel(r.code))}, any roll; select the item in the grid for same-roll fills`,
        );
    } else lines.push(`Value: ${escapeHtml(salesState)}`);
    if (r.stats.readable)
      lines.push(
        `Durability ${r.stats.durability}% · stat ${r.stats.stat}${r.statRank?.status === "ok" ? ` · ${r.statRank.percentile.toFixed(0)}th percentile among ${r.statRank.n} listed peers` : ""}`,
      );
    else lines.push(`Stats unreadable: ${escapeHtml(r.stats.reason ?? "")}`);
    lines.push(
      `Quote ${book?.at ? escapeHtml(ago(book.at, now())) : "missing"} · ${fresh ? "fresh" : "not fresh: no tag"} · displayed price, the market tax is the buyer's · read-only`,
    );
    return `<div class="lens-details" role="region" aria-label="Offer details">${lines.map((l) => `<span>${l}</span>`).join("")}</div>`;
  }
  function annotationHtml(r, kind, ctx) {
    const { open, value, salesState } = ctx;
    const why =
      kind === "loading"
        ? "reading scrap quote"
        : kind === "error"
          ? "quote unavailable"
          : !r.rarity
            ? "rarity unreadable"
            : r.price == null
              ? "price unreadable"
              : !r.q.complete
                ? "bid depth too thin"
                : "no quote";
    const scrap =
      r.v.margin == null
        ? `<span class="lens-kv"><b>–</b><small>scrap · ${escapeHtml(why)}</small></span>`
        : `<span class="lens-kv"><b class="${r.v.margin >= 0 ? "lens-pos" : "lens-neg"}">${signed(r.v.margin)} g</b><small>scrap · ROI ${signed(r.v.marginPct * 100, 1)}%</small></span>`;
    const gapPct =
      value && r.price > 0 ? ((value.amount - r.price) / r.price) * 100 : null;
    const worth = value
      ? `<span class="lens-kv"><b class="${gapPct != null ? (gapPct >= 0 ? "lens-pos" : "lens-neg") : ""}">~${fmt(value.amount)} g</b><small>value · ${escapeHtml(value.label)}</small></span>`
      : `<span class="lens-kv"><b>–</b><small>value · ${escapeHtml(salesState)}</small></span>`;
    return `<span class="lens-tag" data-kind="${kind}">${TAGS[kind]}</span>${scrap}${worth}<button type="button" data-action="details" aria-expanded="${open}" aria-label="${open ? "Hide" : "Show"} details for this offer">${open ? "▾" : "▸"}</button>${open ? detailsHtml(r, ctx) : ""}`;
  }
  /** Scan the rows and annotate them; returns the counts for the bar's pulse. */
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
    const book = state.book;
    const fresh =
      !state.error && freshness(book?.at, s.intervalSec * 1000) === "fresh";
    const loading = !book && !!state.busy;
    const setup = state.setup;
    const salesByCode = state.salesByCode ?? {};
    const salesErrors = state.salesErrors ?? {};
    const avgValues = state.avg?.values ?? {};
    const avgTimes = state.avg?.times ?? {};
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
      const sales = rowCode ? (salesByCode[rowCode] ?? null) : null;
      const value = rowCode
        ? valueOf({
            code: rowCode,
            stats,
            sales,
            avg: avgValues[rowCode],
            avgAt: avgTimes[rowCode] ?? state.avg?.at,
            now: now(),
          })
        : null;
      const flip =
        r.price > 0 &&
        value != null &&
        (value.amount - r.price) / r.price >= s.flipPct / 100;
      return {
        ...r,
        rarity,
        slot,
        code: rowCode,
        stats,
        q,
        v,
        sales,
        value,
        flip,
      };
    });
    const ranks = statRanks(valuations);
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
            : r.v.hit
              ? "hit"
              : r.flip
                ? "flip"
                : r.v.hit == null
                  ? "unknown"
                  : r.v.near
                    ? "near"
                    : "miss";
      r.statRank = ranks[i];
      const base = rowKey(r);
      const ordinal = dupes.get(base) ?? 0;
      dupes.set(base, ordinal + 1);
      const key = ordinal ? `${base}#${ordinal}` : base;
      const open = openDetails.has(key);
      const salesState = !r.code
        ? "item unknown"
        : salesErrors[r.code] && !r.sales
          ? "sales read failed"
          : r.sales
            ? `${comparableFills(r.sales.fills, { code: r.code, now: now(), state: null }).length} of ${MIN_ROLL_SAMPLE} fills in 72 h`
            : state.salesReading === r.code
              ? "reading sales…"
              : state.avg
                ? "no average yet"
                : "reading averages…";
      const rank =
        r.value?.source === "fills" && r.price != null
          ? percentileRank(
              r.price,
              comparableFills(r.sales.fills, {
                code: r.code,
                now: now(),
                state: null,
              }).map((f) => f.price),
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
        s.flipPct,
        r.sales?.at ?? "",
        r.value ? `${r.value.amount}|${r.value.basis}|${r.value.n}` : "",
        salesState,
        r.statRank ? `${r.statRank.n}|${r.statRank.percentile ?? ""}` : "",
        open,
        key,
        open ? Math.floor(now() / 60000) : "",
        open ? (salesErrors[r.code] ?? "") : "",
      ].join("|");
      if (rowMemo.get(el) === memo) continue;
      rowMemo.set(el, memo);
      metrics.rowsWritten++;
      setHtml(
        el,
        annotationHtml(r, kind, {
          open,
          fresh,
          book,
          value: r.value,
          rank,
          salesState,
        }),
      );
    }
    previousRows = current;
    if (!setup) picker(code, s.picker);
    else removePicker();
    const summary = summarizeOffers(valuations);
    last = {
      hits: fresh ? valuations.filter((r) => r.v.hit).length : 0,
      flips: fresh ? valuations.filter((r) => r.flip && !r.v.hit).length : 0,
      scanned: summary.scanned,
      readable: summary.readable,
      code,
      fresh,
    };
    return {
      roots: [
        listRoot,
        ...new Set(rows.map((r) => r.row.parentElement)),
      ].filter(Boolean),
      code,
      count: rows.length,
      ...last,
    };
  }
  /** The bar's pulse: the counts of the last scan, one short phrase. */
  function pulse() {
    if (!last.scanned) return "";
    const parts = [
      `<b>${last.hits}</b> snipe${last.hits === 1 ? "" : "s"}`,
      `<b>${last.flips}</b> flip${last.flips === 1 ? "" : "s"}`,
      `${last.scanned} rows`,
    ];
    return parts.join(" · ");
  }
  /** The Market section: scrap floors and the selected item's recent fills. */
  function renderMarket(body, state) {
    const s = settings();
    const book = state.book;
    const fresh =
      !state.error && freshness(book?.at, s.intervalSec * 1000) === "fresh";
    const floors = dom.RARITIES.map((r) => {
      const q = quote(SCRAP_LADDER[r], book?.bids);
      return `<div class="lens-floor" data-rarity="${r}"><span>${r}</span><b>${fmt(q.value)}</b><small>${SCRAP_LADDER[r]} scraps</small></div>`;
    }).join("");
    const code = last.code;
    const sales = code ? state.salesByCode?.[code] : null;
    const err = code ? state.salesErrors?.[code] : null;
    let salesLine;
    if (!code)
      salesLine = `<p class="lens-muted">Select an item in the grid for its recent fills; rows are valued at the game's average until then.</p>`;
    else if (err && !sales)
      salesLine = `<p class="lens-notice" role="status">Sales of ${escapeHtml(dom.itemLabel(code))}: ${escapeHtml(err)}</p>`;
    else if (!sales)
      salesLine = `<p class="lens-muted">Reading the recent fills of ${escapeHtml(dom.itemLabel(code))}…</p>`;
    else {
      const st = salesStats(sales.fills, {
        now: now(),
        floor: quote(
          SCRAP_LADDER[dom.rarityFromItemCode(code) ?? "common"],
          book?.bids,
        ).value,
      });
      salesLine = `<p class="lens-fills"><b>${escapeHtml(dom.itemLabel(code))}</b> · ${st.count} fills in 72 h${sales.complete ? "" : " (capped)"} · median <b>${fmt(st.median)} g</b> · low ${fmt(st.low)} · high ${fmt(st.high)} · last ${escapeHtml(ago(st.last?.at, now()))}${st.underFloor ? ` · ${st.underFloor} sold under scrap` : ""} · read ${timeLabel(sales.at, now())}${err ? ` · <b>last read failed</b> (${escapeHtml(err)})` : ""}</p>`;
    }
    setHtml(
      body,
      `${state.error ? `<p class="lens-notice" role="status">${escapeHtml(state.error)}${book ? " · showing the last quote" : ""}</p>` : ""}<div class="lens-floors" data-fresh="${fresh}">${floors}</div>${salesLine}<p class="lens-muted lens-legend">SNIPE: the scraps the piece dismantles into sell for more than its price at the observed bids (minimum ROI ${s.minMarginPct}%). FLIP: its value (same-roll fills, else the game's average) sits ${s.flipPct}% or more above the price. Quotes are snapshots, not reserved liquidity.</p>`,
    );
  }
  return { render, renderMarket, pulse, clear, metrics };
}
