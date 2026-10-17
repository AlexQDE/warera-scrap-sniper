// The Craft and Ledger sections of the bar. Craft: one row per tier, what a
// craft costs at the observed asks and what it is worth at the game's
// average item prices (craftboard.mjs). Ledger: the worker's view of the
// player's whole history (observed.mjs): the result, the money and the
// pieces of a window, by activity and tier, and the recent pieces.
// Rendering only. Numbers first; the method lives in the "?" tooltips.
import { fmt, signed, gold, signedGold, escapeHtml as esc } from "./format.mjs";
import {
  setHtml,
  timeLabel,
  helpMark as help,
  SOURCE_TAGS,
  sourceTag,
} from "./ui.mjs";
import { freshness, TTL } from "./quality.mjs";
import { tierBoard, bestTier } from "./craftboard.mjs";
import { itemLabel, slotName, rarityFromItemCode } from "./dom.mjs";
import { comparableFills } from "./resale.mjs";
import { localDayOf } from "./observed.mjs";
import { spanWords, WINDOW_HOURS } from "./similar.mjs";
import { modeSwitch, valueHtml, chosenMark } from "./dialogs.mjs";

const pct = (v, d = 0) => (v == null ? "–" : `${signed(v * 100, d)}%`);
const count = (n) => Number(n ?? 0).toLocaleString("en-US");
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
/** Why `n` wooden cases sit outside the result: toolboxes have no market price, any other drop no price yet. */
const unpricedWooden = (n, toolboxes) =>
  `${count(n)} wooden case${n === 1 ? "" : "s"} left out of the result: ${[
    toolboxes
      ? `${count(toolboxes)} gave toolboxes, which have no market price`
      : "",
    n - toolboxes
      ? `${count(n - toolboxes)} gave a drop without a price yet`
      : "",
  ]
    .filter(Boolean)
    .join("; ")}`;

const CRAFT_HELP =
  "Cost: the tier's scraps and steel walked through the market asks, for a random craft (a sniper craft, the slot chosen, doubles the steel). Worth: the game's average price of each slot at the game's odds (30% weapon, 14% each armour slot). Profit: worth against cost. Expected values, not promises.";

/** The Ledger's list filters: every piece, or the pieces of one source. */
const LIST_SOURCES = [
  ["all", "All"],
  ["crafted", "Craft"],
  ["opened", "Case"],
  ["bought", "Buy"],
  ["looted", "Loot"],
];

export function createCraftDesk({ settings, now = Date.now }) {
  let tier = null; // the tier whose slots are opened on the craft board
  let craftWindow = "today"; // the Ledger's window: today, week, month or all (local days)
  let page = 0; // the page of the Ledger's list asked for, newest first
  let source = "all"; // the Ledger's list: every piece, or one source's
  let pages = 1; // how many pages the last view had

  function reset() {
    tier = null;
    craftWindow = "today";
    page = 0;
    source = "all";
    pages = 1;
  }
  function clear() {
    reset();
  }
  /** Clicks on the desk's own controls; true when one was handled. */
  function onClick(e) {
    const t = e.target.closest("[data-action]");
    if (!t) return false;
    const a = t.dataset.action;
    if (a === "desk-tier") {
      const n = Number(t.dataset.tier);
      tier = tier === n ? null : n;
      return true;
    }
    if (a === "desk-window") {
      craftWindow = ["today", "week", "month", "all"].includes(t.dataset.window)
        ? t.dataset.window
        : "today";
      page = 0;
      return true;
    }
    if (a === "desk-source") {
      source = LIST_SOURCES.some(([k]) => k === t.dataset.source)
        ? t.dataset.source
        : "all";
      page = 0;
      return true;
    }
    if (a === "desk-page") {
      const to = {
        first: 0,
        prev: page - 1,
        next: page + 1,
        last: pages - 1,
      }[t.dataset.page];
      if (to == null) return false;
      page = Math.max(0, Math.min(pages - 1, to));
      return true;
    }
    return false;
  }

  function craftHtml(state, s) {
    const book = state.book;
    const steel = state.cases?.books?.steel ?? null;
    const avg = state.avg;
    const scrapFresh =
      freshness(book?.at, s.intervalSec * 1000, now()) === "fresh";
    const steelFresh = freshness(state.cases?.at, TTL.cases, now()) === "fresh";
    const rows = tierBoard({
      scrapAsks: book?.asks,
      scrapBids: book?.bids,
      steelAsks: steel?.asks,
      avg: avg?.values,
    });
    const top = bestTier(rows);
    const fresh = scrapFresh && steelFresh;
    const prices = `<div class="lens-prices"><span>Scraps <b>${fmt(book?.asks?.[0]?.price)}</b></span><span>Steel <b>${fmt(steel?.asks?.[0]?.price)}</b></span>${book ? `<span class="lens-status" data-status="${fresh ? "fresh" : "stale"}">${timeLabel(book.at, now())}</span>` : ""}${avg ? "" : `<span class="lens-muted">Reading item prices…</span>`}<span class="lens-grow"></span>${help(CRAFT_HELP)}</div>`;
    const cell = (value) => `<td class="lens-num">${value}</td>`;
    const body = rows
      .map((r) => {
        const open = tier === r.tier;
        const cost =
          r.costRandom.value == null
            ? `<span class="lens-muted" title="the market asks do not cover ${esc(r.costRandom.missing.join(" and "))}">no depth</span>`
            : gold(r.costRandom.value);
        const ev =
          r.evRandom == null
            ? `<span class="lens-muted" title="slots with a price">${r.covered}/6</span>`
            : gold(r.evRandom);
        // profit in gold, the percentage small; the chosen slot and its profit in one cell
        const gain =
          r.costRandom.value != null && r.evRandom != null
            ? r.evRandom - r.costRandom.value
            : null;
        const profit =
          gain == null
            ? `<span class="lens-muted">–</span>`
            : `<b class="${cls(gain)}">${signedGold(gain)}</b> <small class="${cls(gain)}">${pct(r.roiRandom)}</small>`;
        const chosen = r.best
          ? `<span title="${esc(itemLabel(r.best.code))} sells ~${gold(r.best.avg)} g; a sniper craft (the slot chosen) costs ${r.costChosen.value == null ? "–" : gold(r.costChosen.value)} g">${esc(slotName(r.best.code))} <small class="${cls(r.roiChosen)}">${pct(r.roiChosen)}</small></span>`
          : `<span class="lens-muted">–</span>`;
        const isBest = top?.row === r;
        const main = `<tr class="lens-tier${isBest ? " lens-best" : ""}" data-rarity="${r.rarity}" aria-expanded="${open}"${isBest ? ` title="best now: ${top.mode === "random" ? "a random craft" : "a sniper craft (the slot chosen)"}"` : ""}><th scope="row"><button type="button" data-action="desk-tier" data-tier="${r.tier}" aria-pressed="${open}"><span aria-hidden="true">${open ? "▾" : "▸"}</span> ${r.rarity}</button></th>${cell(cost)}${cell(ev)}<td class="lens-num">${profit}</td><td>${chosen}</td></tr>`;
        if (!open) return main;
        const slots = r.slots
          .map(
            (sl) =>
              `<span class="lens-chip"><b>${esc(slotName(sl.code))}</b> ${sl.avg == null ? "–" : gold(sl.avg)} <small>${Math.round(sl.odds * 100)}%</small></span>`,
          )
          .join("");
        const chosenCost =
          r.costChosen.value == null
            ? "no depth"
            : `${gold(r.costChosen.value)} g`;
        const reroll =
          r.lossRandom == null
            ? ""
            : ` · bad roll scrapped: ${gold(r.scrapsBack)} g back, <b class="lens-neg">${signedGold(-r.lossRandom)} g</b>`;
        const picked = state.selectedCode;
        const pickedTier =
          picked && rarityFromItemCode(picked) === r.rarity ? picked : null;
        const sales = pickedTier ? state.salesByCode?.[pickedTier] : null;
        const fills = sales
          ? comparableFills(sales.fills, {
              code: pickedTier,
              hours: WINDOW_HOURS,
              now: now(),
              state: null,
            })
          : [];
        const prices = fills.map((f) => f.price);
        const fillsLine = pickedTier
          ? `<p class="lens-muted">${esc(slotName(pickedTier))}: ${
              sales
                ? `${fills.length} sales${fills.length ? ` · median ${gold(median(prices))} · ${gold(Math.min(...prices))}–${gold(Math.max(...prices))}` : ""}`
                : "reading sales…"
            }</p>`
          : "";
        return `${main}<tr class="lens-tier-detail"><td colspan="5"><div class="lens-chips">${slots}</div><p>${r.scraps} scraps + ${r.steelRandom} steel · sniper craft ${r.steelChosen} steel · ${chosenCost}${reroll}</p>${fillsLine}</td></tr>`;
      })
      .join("");
    return `${prices}<table class="lens-board"><thead><tr><th>Tier</th><th class="lens-num">Cost</th><th class="lens-num">Worth</th><th class="lens-num">Profit</th><th>Chosen</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  const cls = (v) => (v == null ? "" : v >= 0 ? "lens-pos" : "lens-neg");
  const money = (v) => `<b class="${cls(v)}">${signedGold(v)}</b>`;
  const hoursWord = (h) =>
    h == null ? "" : h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`;
  const statsWords = (skills) =>
    skills && Object.keys(skills).length
      ? spanWords(
          Object.fromEntries(
            Object.entries(skills).map(([k, v]) => [k, [v, v]]),
          ),
        )
      : "";
  /** Today's money for the bar's head: what was sold or scrapped today against its cost. */
  function pulse(state) {
    const v = state.ledger;
    if (!v || !state.craftsUserId || v.meta?.userId !== state.craftsUserId)
      return "";
    const m = v.windows.today.money;
    const t = v.windows.today;
    if (!m.n && !t.crafted.n && !t.opened.n && !t.bought.n) return "";
    return `cashed <b class="${cls(m.realized)}">${signedGold(m.realized)} g</b>${m.unknownCost ? `<span title="a sale with no cost on record">*</span>` : ""}`;
  }
  const WINDOWS = [
    ["today", "Today"],
    ["week", "7 days"],
    ["month", "30 days"],
    ["all", "All"],
  ];
  const SOURCES = [
    ["crafted", "Crafting", "crafted", "craft"],
    ["opened", "Cases", "cases", "case"],
    ["bought", "Buys", "bought", "buy"],
    ["looted", "Loot", "loot", "loot"],
  ];
  const WINDOW_WORDS = {
    today: "today",
    week: "7 days",
    month: "30 days",
    all: "all time",
  };
  const TIERS = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
  /** What a craft's cost charges for the steel, by the craft mode the view was made with. */
  const STEEL_WORDS = {
    auto: "the base steel for a random craft, twice it for a sniper craft (the slot chosen; ◎: picked in the game's craft window when the extension saw the press, faint when told by a streak of the same slot too long for a random craft)",
    random: "every craft at the random fee (Advanced settings)",
    chosen:
      "every craft as a sniper craft, twice the steel (Advanced settings)",
  };
  /** "13:05", or the day before it outside today, the year too outside this one. */
  const whenWords = (when) => {
    const time = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
    if (craftWindow === "today") return time;
    const day = localDayOf(when.toISOString());
    const sameYear =
      day.slice(0, 4) === localDayOf(new Date(now()).toISOString()).slice(0, 4);
    return `<small>${esc(sameYear ? day.slice(5) : day)}</small> ${time}`;
  };

  function ledgerHtml(state) {
    const id = state.craftsUserId ?? null;
    const v = state.ledger;
    const h = state.history;
    const own = (body) => `<div class="lens-own">${body}</div>`;
    if (!id)
      return own(
        `<p class="lens-muted">Account not found on this page. Set your player id in the extension's settings.</p>`,
      );
    if (!v && state.hasKey === false)
      return own(
        `<p class="lens-muted">Your ledger needs your API key: add it in the extension settings.</p>`,
      );
    if (!v || v.meta?.userId !== id)
      return own(
        `<p class="lens-muted">${state.historyError ? `History read failed: ${esc(state.historyError)}. Retrying.` : `Reading your history${h ? ` · ${count(h.count)} tx` : ""}…`}</p>`,
      );
    const w = v.windows[craftWindow] ?? v.windows.today;
    const meta = v.meta;
    const mode = v.mode ?? state.settings?.ledgerMode ?? "eco";
    const who = meta.username
      ? esc(meta.username)
      : `player …${esc(String(id).slice(-6))}`;
    const steelMode = v.steelMode ?? state.settings?.craftSteelMode ?? "auto";
    const legend = `Your whole history, read once with your key, kept in this browser and updated every minute. Cost: a craft is its recipe at that day's scrap and steel prices, ${STEEL_WORDS[steelMode] ?? STEEL_WORDS.auto}; a case its price that day, a buy what you paid, loot nothing. A held piece counts at what pieces of its stats sold for in 7 days (≈: any stats or the game's average). Eco leaves gear worn in battle out; War counts it. The list holds every piece got or gone in the window, ${count(v.pageSize ?? 50)} a page.${v.approxBefore ? ` The game keeps 30 days of prices: costs before ${v.approxBefore} are approximate (≈).` : ""}`;
    const m = w.money;
    const total = SOURCES.reduce((s, [k]) => s + (w[k]?.estimated ?? 0), 0);
    const pieces = SOURCES.reduce((s, [k]) => s + (w[k]?.n ?? 0), 0);
    const worn = SOURCES.reduce((s, [k]) => s + (w[k]?.worn ?? 0), 0);
    const head = `<div class="lens-own-head"><b title="${esc(`${count(meta.count)} transactions${meta.done ? "" : ", still reading back to your first day"} · read ${localDayOf(meta.at ?? v.at)}`)}">${who}</b>${meta.done ? "" : ` <small>${count(meta.count)} tx, still reading</small>`}${state.historyBusy ? ` <small>reading…</small>` : ""}${state.historyError ? ` <small class="lens-neg">last read failed</small>` : ""}<span class="lens-grow"></span><span class="lens-windows">${WINDOWS.map(([k, label]) => `<button type="button" data-action="desk-window" data-window="${k}" aria-pressed="${craftWindow === k}">${label}</button>`).join("")}</span>${modeSwitch(mode, worn)}${help(legend)}</div>`;
    // what was got in the window at what it sells for now, by source; what was cashed in it, from any piece
    const bySource = SOURCES.filter(([k]) => w[k]?.n)
      .map(
        ([k, , , word]) =>
          `${word} ${money(w[k].estimatedKnown ? w[k].estimated : null)}`,
      )
      .join(" · ");
    const span = WINDOW_WORDS[craftWindow] ?? "today";
    const tile = (label, value, sub) =>
      `<div><small>${label}</small> <b>${value}</b> <span>${sub}</span></div>`;
    const tiles = `<div class="lens-tiles lens-tiles-2">${tile(`Got · ${span}`, `<span class="${cls(total)}">${signedGold(total)} g</span>`, pieces ? `${count(pieces)} piece${pieces === 1 ? "" : "s"}, if sold now${bySource ? `<br>${bySource}` : ""}` : "nothing got")}${tile(`Cashed · ${span}`, `<span class="${cls(m.realized)}">${signedGold(m.realized)} g</span>`, m.n ? `${count(m.sold)} sold · ${count(m.scrapped)} scrapped${m.unknownCost ? ` · ${count(m.unknownCost)} without cost` : ""}` : "nothing sold")}</div>`;
    const chips = [
      ...Object.entries(w.tiers)
        .sort((a, b) => TIERS.indexOf(a[0]) - TIERS.indexOf(b[0]))
        .map(
          ([t, o]) =>
            `<span class="lens-chip" data-rarity="${esc(t)}">${esc(cap(t))} <small>${count(o.n)}</small>${o.chosen ? ` <small class="lens-pick" title="${esc(`${count(o.chosen)} of ${count(o.n)} sniper crafts (slot chosen): twice the steel`)}">◎${count(o.chosen)}</small>` : ""} ${money(o.estimatedKnown ? o.estimated : null)}</span>`,
        ),
      ...(w.wooden.n || w.woodenUnpriced
        ? [
            `<span class="lens-chip"${w.woodenUnpriced ? ` title="${esc(unpricedWooden(w.woodenUnpriced, w.woodenToolboxes ?? 0))}"` : ""}>Wooden <small>${count(w.wooden.n + (w.woodenUnpriced ?? 0))}</small> ${w.wooden.n ? money(w.wooden.value - w.wooden.cost) : "–"}${w.woodenUnpriced ? ` <small>${count(w.woodenUnpriced)} unpriced</small>` : ""}</span>`,
          ]
        : []),
      // v0.27: tools from toolboxes, for the employees; not tradable, so outside every result
      ...(w.tools?.n || w.tools?.scrapped
        ? [
            `<span class="lens-chip" title="Tools from toolboxes, for your employees: not tradable and without a market price, so no result counts them. ♻ what the scrapped ones gave.">Toolbox <small>${count(w.tools.n)}</small>${w.tools.scrapped ? ` <small>♻ ${gold(w.tools.proceeds)}</small>` : ""}</span>`,
          ]
        : []),
    ].join("");
    const rows = (v.rows ?? []).map((p) => {
      const approx = p.approx ? "≈" : "";
      const src = SOURCE_TAGS[p.source];
      const got = src
        ? `${sourceTag(p.source, p.via === "case2" ? "elite case" : p.source === "crafted" ? (p.chosen ? "Crafted: sniper craft (slot chosen)" : "Crafted: random craft") : "")}${chosenMark(p)}${p.source === "looted" ? "" : ` ${gold(p.cost)}${approx}`}`
        : `<span class="lens-muted" title="got before your history starts">–</span>`;
      const inBattle = p.worn && mode !== "war";
      const nowCell =
        p.fate === "sold"
          ? `sold ${gold(p.proceeds)}${p.sellsHours != null ? ` <small>· ${hoursWord(p.sellsHours)}</small>` : ""}`
          : p.fate === "scrapped"
            ? inBattle
              ? `<span class="lens-muted">in battle</span>`
              : `scrap ${gold(p.proceeds)}`
            : valueHtml(p.value);
      const back = p.fate === "held" ? (p.value?.value ?? null) : p.proceeds;
      const pnl =
        !inBattle && back != null && p.cost != null ? back - p.cost : null;
      const when = new Date(p.goneAt ?? p.at ?? Date.now());
      const stats = statsWords(p.skills);
      return `<tr data-fate="${p.fate}" data-source="${p.source}"><td>${whenWords(when)}</td><td>${esc(itemLabel(p.code))}${stats ? ` <small>${esc(stats)}</small>` : ""}</td><td class="lens-num">${got}</td><td class="lens-num">${nowCell}</td><td class="lens-num">${pnl == null ? "" : money(pnl)}</td></tr>`;
    });
    // the whole window, a page at a time: what the worker answered (it may still be answering a click)
    const listTotal = v.rowsTotal ?? rows.length;
    const size = v.pageSize ?? 50;
    const shown = v.page ?? 0;
    pages = Math.max(1, v.pages ?? Math.ceil(listTotal / size));
    page = Math.min(page, pages - 1);
    const listed = v.source ?? "all";
    const counts = v.sources ?? null;
    const filters = counts
      ? `<div class="lens-filters" role="group" aria-label="Pieces by source">${LIST_SOURCES.filter(
          ([k]) => k === "all" || counts[k] || k === source,
        )
          .map(
            ([k, label]) =>
              `<button type="button" data-action="desk-source" data-source="${k}" aria-pressed="${source === k}">${label} <small>${count(counts[k] ?? 0)}</small></button>`,
          )
          .join("")}</div>`
      : "";
    const pageButton = (to, label, name, disabled) =>
      `<button type="button" data-action="desk-page" data-page="${to}" aria-label="${name}" title="${name}"${disabled ? " disabled" : ""}>${label}</button>`;
    const first = shown * size + 1;
    const last = Math.min(listTotal, (shown + 1) * size);
    const pager =
      listTotal > size
        ? `<nav class="lens-pager" aria-label="Pages of pieces">${pageButton("first", "«", "Newest page", shown === 0)}${pageButton("prev", "‹ Newer", "Newer page", shown === 0)}<span>${count(first)}–${count(last)} <small>of ${count(listTotal)}</small></span>${pageButton("next", "Older ›", "Older page", shown >= pages - 1)}${pageButton("last", "»", "Oldest page", shown >= pages - 1)}</nav>`
        : "";
    const list = rows.length
      ? `<div class="lens-scroll" data-scroll="${esc(`ledger:${craftWindow}:${listed}:${shown}`)}"><table class="lens-crafts"><thead><tr><th>When</th><th>Piece</th><th class="lens-num">Cost</th><th class="lens-num">Now</th><th class="lens-num">±</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>${pager}`
      : `<p class="lens-muted">${listed === "all" ? "Nothing in this window." : "None of these in this window."}</p>`;
    return own(
      `${head}${tiles}${chips ? `<div class="lens-chips">${chips}</div>` : ""}${filters}${list}`,
    );
  }

  /** Render `section` ("craft" or "ledger") into the bar's body. */
  function render(body, state, section) {
    const s = settings();
    const html = section === "ledger" ? ledgerHtml(state) : craftHtml(state, s);
    setHtml(
      body,
      `<div class="lens-desk" data-section="${section}">${html}</div>`,
    );
  }
  return {
    render,
    clear,
    reset,
    onClick,
    pulse,
    get window() {
      return craftWindow;
    },
    get page() {
      return page;
    },
    get source() {
      return source;
    },
  };
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
