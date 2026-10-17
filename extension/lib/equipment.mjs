// The equipment market: one verdict line on every offer row (scrap profit
// against the observed bids, what a piece with these stats sells for, a
// tag), the picker filter, and the Market section of the bar (scrap floors,
// the selected item's recent sales). Reading and rendering only; the maths
// live in quality.mjs (depth quotes), dom.mjs (verdict), resale.mjs (the
// window) and similar.mjs (the stat-matched value).
import * as dom from "./dom.mjs";
import { SCRAP_LADDER, scrapYield } from "./ladder.mjs";
import { DEFAULTS } from "./settings.mjs";
import { quote, freshness, TTL, positive } from "./quality.mjs";
import { fmt, signed, gold, signedGold, escapeHtml, ago } from "./format.mjs";
import { setHtml, helpMark, SOURCE_TAGS } from "./ui.mjs";
import {
  tileTokens,
  tileStats,
  tileCode,
  heldIndex,
  tileSource,
  pieceKey,
  statOrder,
  sortGroups,
  meetsFilter,
} from "./picker.mjs";
import { scanList, clickEntry, listRows, selectionCount } from "./vlist.mjs";
import { WEAPONS } from "./items.mjs";
import { ageMinutes } from "./pricing.mjs";
import { salesStats } from "./sales.mjs";
import {
  readStats,
  readStatBlock,
  codeFor,
  summarizeOffers,
  statRanks,
} from "./offers.mjs";
import { comparableFills, percentileRank, liquidity } from "./resale.mjs";
import {
  similarValue,
  rowSkills,
  listedPeers,
  spanWords,
  windowFills,
  WINDOW_HOURS,
  STAT_SHORT,
  PERCENT,
} from "./similar.mjs";

/**
 * The pieces the player holds, for the picker: false with no account to read
 * a history for, "nokey" when there is no API key to read it with, null
 * while the view is on its way, "stale" when the view has none (its worker
 * is older than the page).
 */
export const heldOf = (state) =>
  !state.craftsUserId
    ? false
    : state.hasKey === false
      ? "nokey"
      : !state.ledger
        ? null
        : (state.ledger.heldPieces ?? "stale");

/** A row's listing age in minutes, off its "7m" / "3h47m" line; null when none. */
const rowAge = (lines) => {
  for (const l of lines ?? []) {
    const m = ageMinutes(l);
    if (m != null) return m;
  }
  return null;
};

export const TAGS = {
  hit: "SNIPE",
  flip: "FLIP",
  bid: "BID", // v0.27 auction: the next bid pays (scrap or sale), buying now does not

  near: "NEAR MISS",
  miss: "PASS",
  unknown: "NO QUOTE",
  stale: "STALE",
  loading: "READING",
  error: "NO QUOTE",
};
const FULL_SCAN_EVERY = 30_000;
/**
 * BID shows in an auction's last minutes only: the game has no bid that rises by itself, so a bid placed earlier
 * wins nothing unless the bidder is back at the end, and until then the price is far from final.
 */
const BID_WINDOW_S = 10 * 60;

/**
 * What a piece with these stats sells for: the median of the last 7 days'
 * sales of the same stats (then similar stats; then the item, any stats,
 * which never earns a tag), else the game's average price for the item.
 * null when neither is known.
 */
export function valueOf({ code, stats, sales, avg, avgAt, now, similar }) {
  const skills = rowSkills(code, stats?.stats);
  if (sales?.fills) {
    // the row's stat-matched value when the scan already worked it out, else here
    const v =
      similar ??
      similarValue(
        code,
        skills,
        comparableFills(sales.fills, {
          code,
          hours: WINDOW_HOURS,
          now,
          state: null,
        }),
        { now },
      );
    if (v.value != null)
      return {
        amount: v.value,
        source: "fills",
        basis: v.level,
        matched: v.matched,
        n: v.n,
        label: v.label,
        detail: v.detail,
        hours: v.hours,
        span: v.span,
        low: v.low,
        high: v.high,
        sellsHours: v.sellsHours,
        skills,
      };
  }
  const a = positive(avg);
  if (a != null) {
    const f = freshness(avgAt ?? null, TTL.avg, now);
    return {
      amount: a,
      source: "avg",
      basis: "avg",
      matched: false,
      n: 0,
      label: `game avg, any stats${f === "fresh" ? "" : " (stale)"}`,
      span: {},
      low: null,
      high: null,
      sellsHours: null,
      skills,
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
  let last = {
    hits: 0,
    flips: 0,
    scanned: 0,
    readable: 0,
    code: null,
    unread: 0,
  };
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
  let pickerSource = "all"; // the picker's source filter: all, crafted, bought, opened or looted
  let pickerHeld = null; // the pieces the player holds by their history, for the picker's marks
  let lastAsks = []; // the asks of the last scan: code, price, stats, age
  // The picker's list by stats: the game's whole list, read by scrolling it (vlist.mjs) and read again when it changes.
  let sortScan = null; // { dialog, height, row0, entries: [{ row, col, code, skills, durability }], complete }
  let sortBusy = false;
  let sortCode = null; // the item picked in the list when the market names none
  let sortNote = ""; // what the last click in the list did
  let sortClicked = new Set(); // the places ("row:col") our list clicked in this list
  let sortPicking = false; // a click of ours is on its way
  let sortOpen = false; // the list is shown (and the game's list read) only when asked, each opening
  const removePicker = () => {
    sortScan = null;
    sortCode = null;
    sortNote = "";
    sortClicked = new Set();
    sortOpen = false;
    document.querySelector(".ss-pick-bar")?.remove();
    for (const el of document.querySelectorAll(".ss-src-badge")) el.remove();
    for (const el of document.querySelectorAll(
      "[data-ss-pick], [data-ss-wide], [data-ss-src]",
    )) {
      delete el.dataset.ssPick;
      delete el.dataset.ssWide;
      delete el.dataset.ssSrc;
    }
    pickerTarget = null;
    pickerShowAll = false;
    pickerSource = "all";
  };
  const SOURCE_ORDER = ["crafted", "bought", "opened", "looted"];
  const SOURCE_WORDS = {
    crafted: "crafted",
    bought: "bought",
    opened: "case",
    looted: "loot",
  };
  let pickerCtx = { bids: null, flipPct: DEFAULTS.flipPct, avg: null }; // the scrap bids, FLIP threshold and the game's averages the picker judges with
  /** Bought, and now sells at least the FLIP threshold above what was paid. */
  const flipOf = (p) =>
    p.source === "bought" &&
    p.cost > 0 &&
    p.value?.value != null &&
    p.value.value >= p.cost * (1 + pickerCtx.flipPct / 100);
  /** What a piece's scraps fetch at the bids, at its durability; null without bids. */
  const scrapsOf = (code, durability = 100) => {
    const rarity = dom.rarityFromItemCode(code);
    if (!rarity || !pickerCtx.bids) return null;
    return quote(scrapYield(rarity, durability), pickerCtx.bids).value;
  };
  /** Its scraps fetch more than it sells for. */
  const scrapOf = (p, durability = 100) => {
    const s = scrapsOf(p.code, durability);
    return s != null && p.value?.value != null && s > p.value.value;
  };
  /** A tile's mark: the glyph of every way its identical pieces came, and what the tooltip says. */
  function badgeFor(found, durability = 100) {
    if (!found?.pieces.length)
      return {
        text: "?",
        title: "not in your history: got another way, or before it",
        sources: [],
        flip: false,
        scrap: false,
      };
    const sources = SOURCE_ORDER.filter((s) => found.sources.includes(s));
    const text = sources.map((s) => SOURCE_TAGS[s].glyph).join("/");
    const flip = found.pieces.some(flipOf);
    const scrap = found.pieces.some((p) => scrapOf(p, durability));
    const value = found.pieces.find((p) => p.value?.value != null)?.value.value;
    const scraps = scrap ? scrapsOf(found.pieces[0].code, durability) : null;
    const notes = [
      flip ? "↗ flip" : "",
      scrap ? `♻ scraps ${gold(scraps)} > sells ${gold(value)}` : "",
    ].filter(Boolean);
    if (found.pieces.length === 1) {
      const p = found.pieces[0];
      const day = p.at
        ? new Date(p.at).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
          })
        : "";
      const title = [
        `${SOURCE_TAGS[p.source]?.name ?? p.source}${day ? ` ${day}` : ""}`,
        p.cost != null && p.source !== "looted" ? `cost ${gold(p.cost)}` : "",
        p.value?.value != null && !scrap ? `sells ${gold(p.value.value)}` : "",
        ...notes,
      ]
        .filter(Boolean)
        .join(" · ");
      return { text, title, sources, flip, scrap };
    }
    const counts = sources
      .map(
        (s) =>
          `${found.pieces.filter((p) => p.source === s).length} ${SOURCE_WORDS[s]}`,
      )
      .join(" · ");
    return {
      text,
      title: [`${found.pieces.length} identical: ${counts}`, ...notes].join(
        " · ",
      ),
      sources,
      flip,
      scrap,
    };
  }
  /** A picker row's tiles, column by column: the tile, its item and stats. */
  const readPickerRow = (row) =>
    dom.pickerTiles(row, palette).map((t) => {
      const read = tileStats(tileTokens(t.tile));
      const code = read ? tileCode(t.slot, read.stats) : null;
      return {
        tile: t.tile,
        code,
        skills: code && read ? rowSkills(code, read.stats) : null,
        durability: read?.durability ?? null,
      };
    });
  const keyOfTile = (x) =>
    x.code && x.skills ? pieceKey(x.code, x.skills) : "?";
  /** What tells the list changed (the game's filter, a piece gone): the rows' box height and the first row's pieces when it is in view. */
  function listShape(dialog) {
    const rows = listRows(dialog);
    const row0 = rows.find((r) => r.dataset.index === "0");
    return {
      height: rows[0]?.parentElement?.style.height ?? "",
      row0: row0 ? readPickerRow(row0).map(keyOfTile).join(" ") : null,
    };
  }
  async function scanPicker(dialog) {
    sortBusy = true;
    try {
      const { height } = listShape(dialog);
      const r = await scanList(dialog, readPickerRow);
      if (dom.pickerDialog() !== dialog) return;
      sortClicked = new Set();
      sortScan = {
        dialog,
        height,
        row0: r.entries
          .filter((e) => e.row === 0)
          .map(keyOfTile)
          .join(" "),
        entries: r.entries
          .filter((e) => e.code && e.skills)
          .map(({ tile: _tile, ...e }) => e), // the tiles are re-rendered as the list scrolls: keep what they showed
        complete: r.complete,
      };
    } finally {
      sortBusy = false;
      rescan();
    }
  }
  /** Select the piece clicked in our list in the game's list: one click on its tile, never a second that unselects it. */
  async function pickEntry(id) {
    const dialog = dom.pickerDialog();
    const entry = sortScan?.entries.find((e) => `${e.row}:${e.col}` === id);
    if (!dialog || !entry || sortPicking) return; // one click at a time: a second before the first lands could undo it
    // a window with no counter (Quick dismantle) cannot tell a selected tile: one of ours is never clicked twice there
    if (!selectionCount(dialog) && sortClicked.has(id)) {
      sortNote = "already selected";
      return;
    }
    const key = pieceKey(entry.code, entry.skills);
    sortPicking = true;
    sortClicked.add(id);
    let r;
    try {
      r = await clickEntry(
        dialog,
        entry,
        readPickerRow,
        (x) => keyOfTile(x) === key,
      );
    } finally {
      sortPicking = false;
    }
    if (r === "missing") sortClicked.delete(id);
    sortNote =
      r === "selected"
        ? "selected"
        : r === "already"
          ? "already selected"
          : "not there now: reading the list again";
    if (r === "missing") sortScan = null;
    rescan();
  }
  const unitOf = (k) => (PERCENT.has(k) ? "%" : "");
  /** The list by stats: one button until asked (opening the window reads nothing), then the list under it. */
  function sortHtml(targetCode, index) {
    const label =
      targetCode && !WEAPONS.includes(targetCode) ? "⇅ by stat" : "⇅ by crit";
    const toggle = `<button type="button" data-sort-toggle aria-pressed="${sortOpen}" title="${sortOpen ? "close the list" : "your pieces of this item by crit, then attack (a piece of one stat by that stat); reads the game's list once"}">${label}</button>`;
    return sortOpen
      ? `<div class="lens-sort" data-open>${toggle}${sortBody(targetCode, index)}</div>`
      : `<div class="lens-sort">${toggle}</div>`;
  }
  /** The pieces of one item in the list, by crit then attack (a weapon) or by its one stat, valued, the market filter's pass marked. */
  function sortBody(targetCode, index) {
    if (!sortScan) return `<span class="lens-muted">reading the list…</span>`;
    const counts = new Map();
    for (const e of sortScan.entries)
      if (statOrder(e.code).length)
        counts.set(e.code, (counts.get(e.code) ?? 0) + 1);
    const weapon = (c) => (WEAPONS.includes(c) ? 0 : 1);
    const codes = [...counts.keys()].sort(
      (a, b) => weapon(a) - weapon(b) || counts.get(b) - counts.get(a),
    );
    const code =
      targetCode && counts.has(targetCode)
        ? targetCode
        : !targetCode && sortCode && counts.has(sortCode)
          ? sortCode
          : !targetCode
            ? codes[0]
            : null;
    if (!code)
      return targetCode
        ? `<span class="lens-muted">no ${escapeHtml(dom.itemLabel(targetCode))} in this list</span>`
        : "";
    const chips = targetCode
      ? ""
      : `<span class="lens-sort-codes">${codes
          .map(
            (c) =>
              `<button type="button" data-sort-code="${escapeHtml(c)}" aria-pressed="${c === code}">${escapeHtml(dom.itemLabel(c))} <small>${counts.get(c)}</small></button>`,
          )
          .join("")}</span>`;
    const keys = statOrder(code);
    const filter = code === targetCode ? dom.statFilter(keys) : {};
    const filtered = Object.keys(filter).length > 0;
    const pieces = sortScan.entries.filter((e) => e.code === code);
    const pass = pieces.filter((e) => meetsFilter(e.skills, filter)).length;
    const avg = positive(pickerCtx.avg?.[code]);
    const valueOfPiece = (e) => {
      const p = index
        ?.get(pieceKey(e.code, e.skills))
        ?.find((x) => x.value?.value != null);
      if (p)
        return `${p.value.level === "same" ? "~" : "≈"}${gold(p.value.value)}`;
      return avg != null ? `≈${gold(avg)}` : "";
    };
    const statWords = (e) =>
      keys
        .map((k) => `${STAT_SHORT[k] ?? k} ${e.skills[k]}${unitOf(k)}`)
        .join(" · ");
    const last = /** @type {string} */ (keys.at(-1)); // the stat that varies along a line: a weapon's attack
    const button = (e) => {
      const ok = !filtered || meetsFilter(e.skills, filter);
      const v = valueOfPiece(e);
      return `<button type="button" data-sort-pick="${e.row}:${e.col}" data-pass="${ok}" title="${escapeHtml(`${statWords(e)}${v ? ` · sells ${v}` : ""} · click: select it`)}">${e.skills[last]}${unitOf(last)}${v ? ` <small>${v}</small>` : ""}</button>`;
    };
    const lines = sortGroups(code, pieces)
      .map((g) => {
        return `<div class="lens-sort-g">${g.value != null ? `<b>${g.value}${unitOf(keys[0])}</b>` : ""}${g.pieces.map(button).join("")}</div>`;
      })
      .join("");
    const head = [
      escapeHtml(dom.itemLabel(code)),
      keys.map((k) => STAT_SHORT[k] ?? k).join(", then "),
      filtered
        ? `filter ${Object.entries(filter)
            .map(([k, v]) => `${STAT_SHORT[k] ?? k} ≥${v}${unitOf(k)}`)
            .join(" · ")} → ${pass} of ${pieces.length}`
        : "",
      sortScan.complete ? "" : "part of the list",
      sortNote,
    ]
      .filter(Boolean)
      .join(" · ");
    return `${chips}<div class="lens-sort-head">${head}</div><div class="lens-sort-list">${lines}</div>`;
  }
  /**
   * The inventory picker: every tile marked with how its piece came (by the
   * history), a source filter that dims what another source brought, and the
   * market's item as a removable filter. Dimmed, never hidden: the picker is
   * a virtual list, and a hidden tile would leave a hole in its row.
   */
  function picker(code, enabled, held = pickerHeld, ctx = pickerCtx) {
    pickerHeld = held;
    pickerCtx = ctx;
    const dialog = dom.pickerDialog();
    if (!dialog || !enabled) {
      removePicker();
      return;
    }
    const target = code ? dom.targetFromCode(code) : null;
    const targetCode = target ? code : null;
    if (pickerTarget !== targetCode) {
      pickerTarget = targetCode;
      pickerShowAll = false;
    }
    // the whole list is read when the list by stats is asked for, and again when it changes (a filter of the game's, a piece gone)
    if (sortOpen && !sortBusy) {
      const shape = listShape(dialog);
      if (
        !sortScan ||
        sortScan.dialog !== dialog ||
        shape.height !== sortScan.height ||
        (shape.row0 != null && shape.row0 !== sortScan.row0)
      ) {
        sortScan = null;
        void scanPicker(dialog);
      }
    }
    const tiles = dom.pickerTiles(dialog, palette);
    const matches = target
      ? tiles.filter((t) => dom.pickerDecision(t, target) === "show").length
      : 0;
    const index = Array.isArray(held) ? heldIndex(held) : null;
    for (const t of tiles) {
      let sources = [];
      if (index) {
        const read = tileStats(tileTokens(t.tile));
        const itemCode = read ? tileCode(t.slot, read.stats) : null;
        const b = badgeFor(
          itemCode ? tileSource(index, itemCode, read.stats) : null,
          read?.durability ?? 100,
        );
        sources = [
          ...b.sources,
          ...(b.flip ? ["flip"] : []),
          ...(b.scrap ? ["scrap"] : []),
        ];
        let el = t.tile.querySelector(":scope > .ss-src-badge");
        if (!el) {
          el = document.createElement("span");
          el.className = "ss-src-badge";
          el.dataset.lens = "";
          t.tile.prepend(el);
        }
        if (el.textContent !== b.text) el.textContent = b.text;
        if (el.title !== b.title) el.title = b.title;
        const src = b.sources.join(" ") || "unknown";
        if (t.tile.dataset.ssSrc !== src) t.tile.dataset.ssSrc = src;
      }
      const itemDim =
        target &&
        !pickerShowAll &&
        matches &&
        dom.pickerDecision(t, target) === "hide";
      const sourceDim =
        index && pickerSource !== "all" && !sources.includes(pickerSource);
      const want = itemDim || sourceDim ? "hide" : "show";
      if (t.cell.dataset.ssPick !== want) t.cell.dataset.ssPick = want;
    }
    let bar = dialog.querySelector(".ss-pick-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "ss-pick-bar";
      bar.dataset.lens = "";
      bar.addEventListener("click", (e) => {
        const toggle = e.target.closest("[data-picker-toggle]");
        const source = e.target.closest("[data-picker-source]");
        const sortCodeBtn = e.target.closest("[data-sort-code]");
        const sortToggle = e.target.closest("[data-sort-toggle]");
        const sortPick = e.target.closest("[data-sort-pick]");
        if (!toggle && !source && !sortCodeBtn && !sortPick && !sortToggle)
          return;
        e.preventDefault();
        e.stopPropagation();
        if (toggle) pickerShowAll = !pickerShowAll;
        if (source) pickerSource = source.dataset.pickerSource;
        if (sortCodeBtn) sortCode = sortCodeBtn.dataset.sortCode;
        if (sortToggle) sortOpen = !sortOpen;
        if (sortPick) void pickEntry(sortPick.dataset.sortPick);
        picker(pickerTarget, true);
      });
    }
    // under the card's title (the v0.27 dialog starts with a full-screen backdrop), else at the card's top
    const place = dom.pickerTitle(dialog);
    if (place) {
      if (place.title.nextElementSibling !== bar)
        place.title.insertAdjacentElement("afterend", bar);
    } else if (!bar.isConnected) dom.pickerCard(dialog).prepend(bar);
    const label = targetCode ? escapeHtml(dom.itemLabel(targetCode)) : "";
    const item = !target
      ? ""
      : !matches
        ? `<span class="lens-muted">◎ ${label}: no tile recognized</span>`
        : pickerShowAll
          ? `<button type="button" data-picker-toggle aria-pressed="false" title="show only this item">◎ ${label}</button>`
          : `<span class="lens-chip">◎ ${label} <small>${matches}</small> <button type="button" data-picker-toggle aria-label="show every item" title="show every item">×</button></span>`;
    const counts = Object.fromEntries(
      SOURCE_ORDER.map((s) => [
        s,
        (Array.isArray(held) ? held : []).filter((p) => p.source === s).length,
      ]),
    );
    const filter = Array.isArray(held)
      ? `<span class="lens-srcs" role="group" aria-label="How you got it">${[
          ["all", "All", held.length],
          ...SOURCE_ORDER.map((s) => [
            s,
            `${SOURCE_TAGS[s].glyph} ${SOURCE_TAGS[s].name}`,
            counts[s],
          ]),
          ["flip", "↗ Flip", held.filter(flipOf).length],
          ["scrap", "♻ Scrap", held.filter((p) => scrapOf(p)).length],
        ]
          .filter(([k, , n]) => k === "all" || n > 0)
          .map(
            ([k, name, n]) =>
              `<button type="button" data-picker-source="${k}" aria-pressed="${pickerSource === k}">${name} <small>${n}</small></button>`,
          )
          .join("")}</span>`
      : held === false
        ? `<span class="lens-muted">sources need your history: turn on Craft in settings</span>`
        : held === "nokey"
          ? `<span class="lens-muted">sources need your history, which needs your API key</span>`
          : held === "stale"
            ? `<span class="lens-notice">reload WarEra Plus in the browser's extensions page: its background is older than this page</span>`
            : `<span class="lens-muted">reading your history…</span>`;
    setHtml(
      bar,
      `${item ? `<div class="lens-pick-item">${item}</div>` : ""}${filter}${sortHtml(targetCode, index)}`,
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
    // the picker is not the market's: it opens on any page and removes itself when its dialog closes
    last = {
      hits: 0,
      flips: 0,
      bids: 0,
      scanned: 0,
      readable: 0,
      code: null,
      unread: 0,
    };
  }
  /** One offer's identity across re-renders of the same list: item, price and its own numbers (a duplicate listing gets its ordinal). */
  const rowKey = (r) =>
    `${r.code ?? r.alt ?? ""}|${r.priceText ?? ""}|${r.bidText ?? ""}|${r.stats.stats.join("/")}|${r.stats.durability ?? ""}`;
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
  /** "atk 101 · crit 16%": the row's own stats in words. */
  const statWords = (r) =>
    r.value?.skills
      ? spanWords(
          Object.fromEntries(
            Object.entries(r.value.skills).map(([k, v]) => [k, [v, v]]),
          ),
        )
      : r.stats.stats.length
        ? `stat ${r.stats.stats.join(" / ")}`
        : "stats unreadable";
  function detailsHtml(r, { fresh, book, value, rank, salesState, peers }) {
    const lines = [];
    if (r.rarity)
      lines.push(
        `Dismantle: <b>${SCRAP_LADDER[r.rarity]}</b> scraps (${escapeHtml(r.rarity)}) at the observed bids = <b>${fmt(r.q.value)} g</b>${r.q.complete ? "" : ` · only ${r.q.filled} covered by observed bids`}`,
      );
    else lines.push("Rarity unreadable: the frame border is off-palette");
    if (r.v.margin != null)
      lines.push(
        `${r.kind === "auction" ? "Buy now" : "Offer"} <b>${fmt(r.price)} g</b> · scrap covers ${r.v.coverPct.toFixed(0)}% of it · ${r.v.ratio.toFixed(2)}× its scrap floor`,
      );
    else if (r.price == null) lines.push("Price unreadable on this row");
    if (r.kind === "auction") {
      const rate = r.tax?.rate;
      const pct = rate != null ? Math.round(rate * 1000) / 10 : null;
      lines.push(
        `Auction: buy now <b>${fmt(r.price)} g</b>${r.max != null ? ` (max ${fmt(r.max)} before tax)` : ""} · next bid <b>${fmt(r.bid)} g</b>${rate != null && r.bid != null && !r.taxBad ? ` (${fmt(r.bid / (1 + rate))} before tax)` : ""}${r.start != null ? ` · start or current bid ${fmt(r.start)}` : ""}${r.ends ? ` · ends in ${escapeHtml(r.ends)}` : ""}`,
      );
      lines.push(
        r.taxBad
          ? `Tax check failed: the card's buy now and max price do not agree with the tax on the page${pct != null ? ` (${pct}%)` : ""}, so no tag`
          : `Your ${pct}% market tax (${r.tax?.source === "card" ? "read off the card: buy now ÷ max" : "the page's notice"}) is in the buttons' amounts, not in the card's prices${r.bidding?.ceiling != null ? ` · bid at most <b>${r.bidding.ceiling.toFixed(2)}</b> before tax for the SNIPE or FLIP margin` : ""} · a bid in the last minute adds a minute, so the price is not final until the auction ends · the game has no bid that rises by itself: a bid wins only if you are there at the end, so BID shows in the auction's last ${BID_WINDOW_S / 60} minutes`,
      );
    }
    lines.push(
      `This piece: ${escapeHtml(statWords(r))}${r.stats.durability != null ? ` · ${r.stats.durability}% durability` : ""}${r.statRank?.status === "ok" ? ` · ${r.statRank.percentile.toFixed(0)}th percentile among ${r.statRank.n} listed` : ""}`,
    );
    if (value) {
      // a card that failed the tax check has no price to measure against
      const gap = r.price != null && !r.taxBad ? value.amount - r.price : null;
      lines.push(
        `Sells for <b>${fmt(value.amount)} g</b> · ${escapeHtml(value.detail ?? value.label)}${value.low != null ? ` · ${fmt(value.low)}–${fmt(value.high)}` : ""}${value.sellsHours != null ? ` · listed to sold in ${value.sellsHours < 1 ? `${Math.round(value.sellsHours * 60)} min` : `${value.sellsHours.toFixed(1)} h`} (median)` : ""}${gap != null ? ` · against this price <b>${signed(gap)} g</b> (${signed((gap / r.price) * 100, 1)}%)` : ""}`,
      );
      if (value.source === "fills" && r.sales) {
        const fills = comparableFills(r.sales.fills, {
          code: r.code,
          hours: WINDOW_HOURS,
          now: now(),
          state: null,
        });
        const liq = liquidity(fills, { now: now(), hours: WINDOW_HOURS });
        lines.push(
          `${fills.length} sales of ${escapeHtml(dom.itemLabel(r.code))} in 7 d, any stats${r.sales.complete ? "" : " (sample capped)"} · ${liq.perDay.toFixed(1)}/day · last ${escapeHtml(ago(liq.lastAt, now()))}${rank?.status === "ok" ? ` · this price sits at the ${rank.percentile.toFixed(0)}th percentile of the matched sales` : ""}${!value.matched ? " · no tag: too few sales with these stats" : ""}`,
        );
      } else if (value.source === "avg")
        lines.push(
          `The game's average is a mean of recent sales of ${escapeHtml(dom.itemLabel(r.code))}, any stats; no tag rests on it · ${escapeHtml(salesState)}`,
        );
    } else lines.push(`Sells for: ${escapeHtml(salesState)}`);
    if (peers?.n)
      lines.push(
        `Listed now with these stats: ${peers.n} other${peers.n === 1 ? "" : "s"} from <b>${fmt(peers.cheapest)} g</b>${r.price != null && !r.taxBad && peers.cheapest > r.price ? ` · this one is ${signed(((peers.cheapest - r.price) / r.price) * 100, 1)}% under the cheapest of them` : ""}`,
      );
    lines.push(
      `Quote ${book?.at ? escapeHtml(ago(book.at, now())) : "missing"} · ${fresh ? "fresh" : "not fresh: no tag"} · ${r.kind === "auction" ? "the buttons' amounts include your tax" : "displayed price, the market tax is the buyer's"} · read-only`,
    );
    return `<div class="lens-details" role="region" aria-label="Offer details">${lines.map((l) => `<span>${l}</span>`).join("")}</div>`;
  }
  function annotationHtml(r, kind, ctx) {
    const { open, value, salesState } = ctx;
    const why =
      kind === "loading"
        ? "reading"
        : kind === "error"
          ? "quote unavailable"
          : r.taxBad
            ? "tax check failed"
            : !r.rarity
              ? "rarity unreadable"
              : r.price == null
                ? "price unreadable"
                : !r.q.complete
                  ? "bid depth too thin"
                  : "no quote";
    // Two routes: scrap it, or sell it at what pieces of these stats sold for. The verdict's route is the big
    // number; a PASS shows the better route, muted. The value's mark: none for the same stats, ≈ otherwise.
    const scrapRoute =
      r.v.margin != null ? { gain: r.v.margin, pct: r.v.marginPct } : null;
    const sellRoute =
      value?.matched && r.price > 0 && !r.taxBad
        ? {
            gain: value.amount - r.price,
            pct: (value.amount - r.price) / r.price,
          }
        : null;
    // an auction tagged BID: the gain at the next bid, the better of its two routes
    const bidRoute =
      kind === "bid"
        ? [r.bidding?.scrap, r.bidding?.sell]
            .filter(Boolean)
            .sort((a, b) => b.gain - a.gain)[0]
        : null;
    const route =
      kind === "hit"
        ? scrapRoute
        : kind === "flip"
          ? sellRoute
          : kind === "bid"
            ? bidRoute
            : [scrapRoute, sellRoute]
                .filter(Boolean)
                .sort((a, b) => b.gain - a.gain)[0];
    const loud = kind === "hit" || kind === "flip" || kind === "bid";
    const big = route
      ? `<b class="lens-gain ${loud ? (route.gain >= 0 ? "lens-pos" : "lens-neg") : "lens-muted"}">${signedGold(route.gain)} · ${signed(route.pct * 100, 0)}%</b>`
      : `<b class="lens-gain lens-muted">–</b>`;
    const scrap =
      r.v.margin != null && r.price != null
        ? `scrap ${gold(r.price + r.v.margin)}`
        : `scrap · ${escapeHtml(why)}`;
    const mark =
      value && !(value.source === "fills" && value.basis === "same") ? "≈" : "";
    const sells = value
      ? `sells ${mark}${gold(value.amount)} · ${escapeHtml(value.source === "avg" ? "game avg" : value.label)}`
      : `sells · ${escapeHtml(salesState)}`;
    // an auction: what the verdict is for, buying now or bidding up to the ceiling (bids are typed before tax)
    const how =
      r.kind !== "auction"
        ? ""
        : kind === "bid" && r.bidding?.ceiling != null
          ? `<span title="the most to bid for this margin, before tax (bids are typed before tax; your country adds ${Math.round((r.tax?.rate ?? 0) * 1000) / 10}%). A bid in the last minute adds a minute: the price is not final until the auction ends.">bid ≤ ${r.bidding.ceiling.toFixed(2)}</span> · `
          : kind === "hit" || kind === "flip"
            ? "buy now · "
            : "";
    return `<span class="lens-tag" data-kind="${kind}">${TAGS[kind]}</span><span class="lens-kv">${big}<small>${how}${scrap} · ${sells}</small></span><button type="button" data-action="details" aria-expanded="${open}" aria-label="${open ? "Hide" : "Show"} details for this offer">${open ? "▾" : "▸"}</button>${open ? detailsHtml(r, ctx) : ""}`;
  }
  /** Scan the rows and annotate them; returns the counts for the bar's pulse. */
  function render(state) {
    // A scoped scan is trusted only when it finds a list (two rows or more);
    // one row says nothing about where the next ones will be inserted.
    const periodic = now() - lastFullScan >= FULL_SCAN_EVERY;
    if (periodic) rowCache.epoch++; // frames and borders are re-read on the periodic full scan
    // the v0.26 offer rows (BUY) and the v0.27 auction cards (buy now, bid): a page shows one or the other
    const readRows = (root) => [
      ...dom.offerRows(root, palette, rowCache),
      ...dom.auctionRows(root, palette, rowCache),
    ];
    const scoped = listRoot?.isConnected && !periodic ? readRows(listRoot) : [];
    let rows = scoped;
    if (scoped.length >= 2) metrics.scopedScans++;
    else {
      rows = readRows(document);
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
      // v0.27 shows the grid only in its "Select an item" modal: the palette read there is kept after it closes
      if (live.length) palette = dom.withFallbackPalette(live);
      calibratedAt = now();
    }
    const code =
      dom.selectedItemCode() ?? dom.filteredItemCode(location.search);
    const s = settings();
    const book = state.book;
    const fresh =
      !state.error && freshness(book?.at, s.intervalSec * 1000) === "fresh";
    // no quote yet and no failed read: it is being read, from the very first scan (the reads start right after it)
    const loading = !book && !state.error;
    const setup = state.setup;
    const salesByCode = state.salesByCode ?? {};
    const salesErrors = state.salesErrors ?? {};
    const avgValues = state.avg?.values ?? {};
    const avgTimes = state.avg?.times ?? {};
    // One clock for the scan; per item one list of comparable sales, kept across scans for a minute per read
    // (similar.windowFills), so every row of an item shares it and the worth of its stats is read once.
    const t = now();
    const fillsOf = (sales) => windowFills(sales, t);
    // the buyer's market tax the notice prints: the auction cards' buttons carry it, their prices do not
    const noticeTax = rows.some((r) => r.kind === "auction")
      ? dom.taxRateFromText(dom.taxNotice()?.textContent)
      : null;
    const margin = Math.max(0, Number(s.minMarginPct) || 0) / 100;
    const valuations = rows.map((r) => {
      const auction = r.kind === "auction";
      const slot = dom.slotFromAlt(r.alt);
      const stats = auction ? readStatBlock(r.tokens) : readStats(r.lines);
      // Trust the row first; a just-changed grid selection can precede replacement of the list. The row's image
      // named by its item code says the rarity outright; a skin's name does not, and then its frame does (an
      // auction card's frame has no border: there the tier its stat falls in says it, as in the picker).
      const named = dom.rarityFromItemCode(r.alt) ? r.alt : null;
      const borderRarity = dom.rarityFromBorder(r.border, palette);
      const rowCode = auction
        ? (named ?? tileCode(slot, stats.stats) ?? codeFor(slot, borderRarity))
        : (codeFor(slot, dom.rarityFromItemCode(r.alt) ?? borderRarity) ??
          named);
      const rarity = dom.rarityFromItemCode(rowCode ?? r.alt) ?? borderRarity;
      // an auction card's buttons include the tax and its prices do not: no verdict until the two agree
      const tax = auction
        ? dom.auctionTax({ price: r.price, max: r.max }, noticeTax)
        : null;
      const usable = !auction || tax.ok;
      const q = rarity
        ? quote(SCRAP_LADDER[rarity], book?.bids)
        : { value: null, complete: false, filled: 0 };
      const v = dom.verdict({
        price: usable ? r.price : null,
        floor: q.value,
        minMarginPct: s.minMarginPct,
      });
      const sales = rowCode ? (salesByCode[rowCode] ?? null) : null;
      const skills = rowSkills(rowCode, stats.stats);
      // the row's value from the sales of its stats, worked out once and used by the line, the label and the rank
      const similar =
        rowCode && sales?.fills
          ? similarValue(rowCode, skills, fillsOf(sales), { now: t })
          : null;
      const value = rowCode
        ? valueOf({
            code: rowCode,
            stats,
            sales,
            avg: avgValues[rowCode],
            avgAt: avgTimes[rowCode] ?? state.avg?.at,
            now: t,
            similar: similar ?? undefined,
          })
        : null;
      // Only a value resting on sales of these stats can call a listing cheap.
      const flip =
        usable &&
        r.price > 0 &&
        value != null &&
        value.matched &&
        (value.amount - r.price) / r.price >= s.flipPct / 100;
      // The auction's other way in: the next bid. It pays when the scraps or the sales of these stats cover it
      // with the SNIPE or FLIP margin; the most worth bidding (before tax, as bids are typed) is the ceiling. It is
      // a BID in the auction's last minutes only (BID_WINDOW_S): a countdown that does not read is none.
      let bidding = null;
      if (auction && usable && r.bid > 0) {
        const vb = dom.verdict({
          price: r.bid,
          floor: q.value,
          minMarginPct: s.minMarginPct,
        });
        const flipBid =
          value != null &&
          value.matched &&
          (value.amount - r.bid) / r.bid >= s.flipPct / 100;
        const ceilings = [
          q.value != null && q.complete ? q.value / (1 + margin) : null,
          value?.matched ? value.amount / (1 + s.flipPct / 100) : null,
        ].filter((c) => c != null);
        const ceilingTaxed = ceilings.length ? Math.max(...ceilings) : null;
        const closing =
          (dom.countdownSeconds(r.ends) ?? Infinity) <= BID_WINDOW_S;
        bidding = {
          hit: closing && (!!vb.hit || flipBid),
          scrap:
            vb.margin != null ? { gain: vb.margin, pct: vb.marginPct } : null,
          sell: value?.matched
            ? {
                gain: value.amount - r.bid,
                pct: (value.amount - r.bid) / r.bid,
              }
            : null,
          ceiling:
            ceilingTaxed == null
              ? null
              : Math.floor((ceilingTaxed / (1 + tax.rate)) * 100) / 100,
        };
      }
      return {
        ...r,
        rarity,
        slot,
        code: rowCode,
        stats,
        skills,
        similar,
        ageMin: auction ? null : rowAge(r.lines),
        q,
        v,
        sales,
        value,
        flip,
        tax,
        taxBad: auction && !tax.ok,
        bidding,
      };
    });
    // the asks on the page, for the sell form's suggestion (an auction's prices are not asks)
    lastAsks = valuations
      .filter((r) => r.kind !== "auction" && r.code && r.price > 0)
      .map((r) => ({
        code: r.code,
        price: r.price,
        skills: r.skills,
        ageMin: r.ageMin,
      }));
    // Every item on the page gets its sales read, the grid's item first.
    const codes = [...new Set(valuations.map((r) => r.code).filter(Boolean))];
    if (code || codes.length) requestSales(code, codes);
    const ranks = statRanks(valuations);
    const current = new Set(rows.map((r) => r.row));
    for (const row of previousRows)
      if (!current.has(row)) {
        row.querySelector(":scope > .ss-verdict")?.remove();
        delete row.dataset.scrapSniper;
      }
    const dupes = new Map();
    // a card that failed the tax check has no price another row can be measured against
    const peerRows = valuations.map((r) =>
      r.taxBad ? { ...r, price: null } : r,
    );
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
                : r.bidding?.hit
                  ? "bid"
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
          : r.similar
            ? r.similar.label
            : state.salesReading === r.code
              ? "reading sales…"
              : state.avg
                ? "no average yet"
                : "reading averages…";
      const rank =
        r.value?.source === "fills" && r.price != null && !r.taxBad && r.similar
          ? percentileRank(
              r.price,
              (r.value.matched ? r.similar.fills : fillsOf(r.sales)).map(
                (f) => f.price,
              ),
            )
          : null;
      const peers = r.code ? listedPeers(r.code, r.skills, peerRows, i) : null;
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
      // open Details take the row's whole width; closed, the line keeps one width whatever it says
      if (open) el.dataset.open = "";
      else delete el.dataset.open;
      const memo = [
        kind,
        book?.at ?? "",
        s.minMarginPct,
        s.flipPct,
        r.sales?.at ?? "",
        r.value
          ? `${r.value.amount}|${r.value.basis}|${r.value.n}|${r.value.matched}`
          : "",
        salesState,
        r.statRank ? `${r.statRank.n}|${r.statRank.percentile ?? ""}` : "",
        peers ? `${peers.n}|${peers.cheapest ?? ""}` : "",
        open,
        key,
        r.bid ?? "",
        r.bidding?.ceiling ?? "",
        r.tax ? `${r.tax.ok}|${r.tax.rate}` : "",
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
          peers,
        }),
      );
    }
    previousRows = current;
    // no account to read a history for: say so in the picker (false), else the pieces once the view arrives
    if (!setup)
      picker(code, s.picker, heldOf(state), {
        bids: state.book?.bids ?? null,
        flipPct: s.flipPct,
        avg: state.avg?.values ?? null,
      });
    else removePicker();
    const summary = summarizeOffers(valuations);
    last = {
      hits: fresh ? valuations.filter((r) => r.v.hit).length : 0,
      flips: fresh ? valuations.filter((r) => r.flip && !r.v.hit).length : 0,
      bids: fresh
        ? valuations.filter((r) => r.bidding?.hit && !r.v.hit && !r.flip).length
        : 0,
      scanned: summary.scanned,
      readable: summary.readable,
      code,
      fresh,
      // offer buttons on the page and no row read: the game changed under the reader
      unread: rows.length ? 0 : dom.offerButtonCount(),
    };
    return {
      roots: [
        listRoot,
        ...new Set(rows.map((r) => r.row.parentElement)),
      ].filter(Boolean),
      code,
      codes,
      count: rows.length,
      ...last,
    };
  }
  /** The bar's pulse: the counts of the last scan, one short phrase. */
  function pulse() {
    if (!last.scanned) {
      if (!last.unread) return "";
      const build = dom.buildId();
      const title = `WarEra Plus could not read the ${last.unread} offer button${last.unread === 1 ? "" : "s"} on this page: the game may have changed${build ? ` (build ${build})` : ""}. Reload the page; if it stays, look for a WarEra Plus update.`;
      return `<span class="lens-neg" title="${escapeHtml(title)}">⚠ offers not read</span>`;
    }
    const parts = [
      last.hits ? `<b>${last.hits}</b> snipe${last.hits === 1 ? "" : "s"}` : "",
      last.flips
        ? `<b>${last.flips}</b> flip${last.flips === 1 ? "" : "s"}`
        : "",
      last.bids ? `<b>${last.bids}</b> bid${last.bids === 1 ? "" : "s"}` : "",
    ];
    return parts.filter(Boolean).join(" · ");
  }
  /** The Market section: scrap floors and the selected item's recent sales. */
  function renderMarket(body, state) {
    const s = settings();
    const book = state.book;
    const fresh =
      !state.error && freshness(book?.at, s.intervalSec * 1000) === "fresh";
    const floors = dom.RARITIES.map((r) => {
      const q = quote(SCRAP_LADDER[r], book?.bids);
      return `<div class="lens-floor" data-rarity="${r}"><span>${r}</span><b>${gold(q.value)}</b><small>${SCRAP_LADDER[r]} scraps</small></div>`;
    }).join("");
    const code = last.code;
    const sales = code ? state.salesByCode?.[code] : null;
    const err = code ? state.salesErrors?.[code] : null;
    const legend = helpMark(
      `Floors: what each rarity dismantles into at the scrap bids. SNIPE: the scraps a piece dismantles into sell for more than its price (minimum ROI ${s.minMarginPct}%). FLIP: pieces with these stats sold in the last 7 days for ${s.flipPct}% or more above this price; the game's average never earns it. On an auction both judge buying now (the button's amount, with your tax); BID: the next bid pays one way or the other, and bid ≤ is the most to bid for that margin, before tax (the price is not final until the auction ends). ~ is a value from sales of the same stats, ≈ from any stats or the game's average. Quotes are snapshots, not reserved liquidity.`,
    );
    let salesLine;
    if (!code)
      salesLine = `<p class="lens-fills lens-muted">Pick an item in the grid for its sales ${legend}</p>`;
    else if (err && !sales)
      salesLine = `<p class="lens-notice" role="status">Sales of ${escapeHtml(dom.itemLabel(code))}: ${escapeHtml(err)}</p>`;
    else if (!sales && state.hasKey === false)
      salesLine = `<p class="lens-fills lens-muted">Sales by stats need your API key: values are the game's average ${legend}</p>`;
    else if (!sales)
      salesLine = `<p class="lens-fills lens-muted">Reading sales of ${escapeHtml(dom.itemLabel(code))}… ${legend}</p>`;
    else {
      const st = salesStats(sales.fills, {
        hours: WINDOW_HOURS,
        now: now(),
        floor: quote(
          SCRAP_LADDER[dom.rarityFromItemCode(code) ?? "common"],
          book?.bids,
        ).value,
      });
      salesLine = `<p class="lens-fills"><b>${escapeHtml(dom.itemLabel(code))}</b> · ${st.count}${sales.complete ? "" : "+"} sales · 7 d · median <b>${gold(st.median)}</b> · ${gold(st.low)}–${gold(st.high)} · last ${escapeHtml(ago(st.last?.at, now()))}${st.underFloor ? ` · ${st.underFloor} under scrap` : ""}${err ? ` · <b>last read failed</b> (${escapeHtml(err)})` : ""} <span title="read ${escapeHtml(ago(sales.at, now()))}">${legend}</span></p>`;
    }
    setHtml(
      body,
      `${state.error ? `<p class="lens-notice" role="status">${escapeHtml(state.error)}${book ? " · showing the last quote" : ""}</p>` : ""}<div class="lens-floors" data-fresh="${fresh}">${floors}</div>${salesLine}`,
    );
  }
  return {
    render,
    renderMarket,
    pulse,
    clear,
    metrics,
    /** The inventory picker and the Quick dismantle window, on any page. */
    picker,
    /** The asks the market showed on its last scan for `code`, with their age. */
    asks: (/** @type {string} */ code) =>
      lastAsks.filter((a) => a.code === code),
  };
}
