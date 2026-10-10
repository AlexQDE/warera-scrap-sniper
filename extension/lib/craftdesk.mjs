// The Craft and Ledger sections of the bar. Craft: one row per tier, what a
// craft costs at the observed asks and what it is worth at the game's
// average item prices (craftboard.mjs). Ledger: the worker's view of the
// player's whole history (observed.mjs): the result, the money and the
// pieces of a window, by activity and tier, and the recent pieces.
// Rendering only. Numbers first; the method lives in the "?" tooltips.
import { fmt, signed, gold, signedGold, escapeHtml as esc } from "./format.mjs";
import { setHtml, timeLabel, helpMark as help } from "./ui.mjs";
import { freshness, TTL } from "./quality.mjs";
import { tierBoard, bestTier } from "./craftboard.mjs";
import { itemLabel, slotName, rarityFromItemCode } from "./dom.mjs";
import { comparableFills } from "./resale.mjs";
import { localDayOf } from "./observed.mjs";
import { spanWords, WINDOW_HOURS } from "./similar.mjs";
import { modeSwitch } from "./dialogs.mjs";

const pct = (v, d = 0) => (v == null ? "–" : `${signed(v * 100, d)}%`);
const count = (n) => Number(n ?? 0).toLocaleString("en-US");
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

const CRAFT_HELP =
  "Cost: the tier's scraps and steel walked through the market asks, for a random craft (a chosen slot doubles the steel). Worth: the game's average price of each slot at the game's odds (30% weapon, 14% each armour slot). Profit: worth against cost. Expected values, not promises.";

export function createCraftDesk({ settings, now = Date.now }) {
  let tier = null; // the tier whose slots are opened on the craft board
  let craftWindow = "today"; // the Ledger's window: today, week, month or all (local days)

  function reset() {
    tier = null;
    craftWindow = "today";
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
    const cell = (value, cls = "") =>
      `<td class="lens-num ${cls}">${value}</td>`;
    const roiCell = (roi) =>
      cell(
        pct(roi),
        roi == null ? "lens-muted" : roi >= 0 ? "lens-pos" : "lens-neg",
      );
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
        const best = r.best
          ? `${esc(slotName(r.best.code))} <small>${gold(r.best.avg)}</small>`
          : `<span class="lens-muted">–</span>`;
        const main = `<tr class="lens-tier" data-rarity="${r.rarity}" aria-expanded="${open}"><th scope="row"><button type="button" data-action="desk-tier" data-tier="${r.tier}" aria-pressed="${open}">${r.rarity}</button></th>${cell(cost)}${cell(ev)}${roiCell(r.roiRandom)}<td>${best}</td>${roiCell(r.roiChosen)}</tr>`;
        if (!open) return main;
        const slots = r.slots
          .map(
            (sl) =>
              `<span class="lens-chip"><b>${esc(slotName(sl.code))}</b> ${sl.avg == null ? "–" : gold(sl.avg)} <small>${Math.round(sl.odds * 100)}%</small></span>`,
          )
          .join("");
        const chosen =
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
        return `${main}<tr class="lens-tier-detail"><td colspan="6"><div class="lens-chips">${slots}</div><p>${r.scraps} scraps + ${r.steelRandom} steel · chosen slot ${r.steelChosen} steel · ${chosen}${reroll}</p>${fillsLine}</td></tr>`;
      })
      .join("");
    const headline = top
      ? `<p class="lens-headline">Best now: <b>${top.row.rarity}</b> ${top.mode === "random" ? `random <b class="${top.row.roiRandom >= 0 ? "lens-pos" : "lens-neg"}">${pct(top.row.roiRandom)}</b>` : `${esc(slotName(top.row.best?.code))} chosen <b class="${top.row.roiChosen >= 0 ? "lens-pos" : "lens-neg"}">${pct(top.row.roiChosen)}</b>`}</p>`
      : "";
    return `${prices}${headline}<table class="lens-board"><thead><tr><th>Tier</th><th class="lens-num">Cost</th><th class="lens-num">Worth</th><th class="lens-num">Profit</th><th>Best slot</th><th class="lens-num">Profit</th></tr></thead><tbody>${body}</tbody></table>`;
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
    return `today <b class="${cls(m.realized)}">${signedGold(m.realized)} g</b>${m.unknownCost ? `<span title="a sale with no cost on record">*</span>` : ""}`;
  }
  const WINDOWS = [
    ["today", "Today"],
    ["week", "7 days"],
    ["month", "30 days"],
    ["all", "All"],
  ];
  const SOURCES = [
    ["crafted", "Crafting", "crafted"],
    ["opened", "Cases", "cases"],
    ["bought", "Buys", "bought"],
    ["looted", "Loot", "loot"],
  ];
  const TIERS = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
  const ROWS_SHOWN = 30;

  function ledgerHtml(state) {
    const id = state.craftsUserId ?? null;
    const v = state.ledger;
    const h = state.history;
    const own = (body) => `<div class="lens-own">${body}</div>`;
    if (!id)
      return own(
        `<p class="lens-muted">Account not found on this page. Set your player id in the extension's settings.</p>`,
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
    const legend = `Your whole history, read once with your key, kept in this browser and updated every minute. Cost: a craft is its recipe at that day's scrap and steel prices (${state.settings?.craftSteelMode === "chosen" ? "chosen slot" : "random craft"}), a case its price that day, a buy what you paid, loot nothing. A held piece counts at what pieces of its stats sold for in 7 days (≈: any stats or the game's average). Eco leaves gear worn in battle out; War counts it.${v.approxBefore ? ` The game keeps 30 days of prices: costs before ${v.approxBefore} are approximate (≈).` : ""}`;
    const head = `<div class="lens-own-head"><b>${who}</b> <small>${count(meta.count)} tx${meta.done ? "" : ", still reading"} · ${timeLabel(meta.at ?? v.at, now())}${state.historyBusy ? " · reading" : ""}</small>${state.historyError ? ` <small class="lens-neg">last read failed</small>` : ""}<span class="lens-grow"></span><span class="lens-windows">${WINDOWS.map(([k, label]) => `<button type="button" data-action="desk-window" data-window="${k}" aria-pressed="${craftWindow === k}">${label}</button>`).join("")}</span>${modeSwitch(mode)}${help(legend)}</div>`;
    const m = w.money;
    const total = SOURCES.reduce((s, [k]) => s + (w[k]?.estimated ?? 0), 0);
    const pieces = SOURCES.reduce((s, [k]) => s + (w[k]?.n ?? 0), 0);
    const held = SOURCES.reduce((s, [k]) => s + (w[k]?.held ?? 0), 0);
    const worn = SOURCES.reduce((s, [k]) => s + (w[k]?.worn ?? 0), 0);
    const parts = SOURCES.filter(([k]) => w[k]?.n)
      .map(([k, , word]) => `${count(w[k].n)} ${word}`)
      .join(" · ");
    const tile = (label, value, sub) =>
      `<div><small>${label}</small> <b>${value}</b> <span>${sub}</span></div>`;
    const tiles = `<div class="lens-tiles">${tile("Result", `<span class="${cls(total)}">${signedGold(total)} g</span>`, `${held ? `${count(held)} held at their stats' price` : "nothing held"}${worn && mode !== "war" ? ` · ${count(worn)} in battle, not counted` : ""}`)}${tile("Sold &amp; scrapped", `<span class="${cls(m.realized)}">${signedGold(m.realized)} g</span>`, m.n ? `${count(m.sold)} sold · ${count(m.scrapped)} scrapped${m.unknownCost ? ` · ${count(m.unknownCost)} without cost` : ""}` : "nothing sold")}${tile("Pieces", count(pieces), parts || "none")}</div>`;
    const chips = [
      ...SOURCES.filter(([k]) => w[k]?.n).map(
        ([k, name]) =>
          `<span class="lens-chip">${name} ${money(w[k].estimatedKnown ? w[k].estimated : null)}</span>`,
      ),
      ...Object.entries(w.tiers)
        .sort((a, b) => TIERS.indexOf(a[0]) - TIERS.indexOf(b[0]))
        .map(
          ([t, o]) =>
            `<span class="lens-chip" data-rarity="${esc(t)}">${esc(cap(t))} <small>${count(o.n)}</small> ${money(o.estimatedKnown ? o.estimated : null)}</span>`,
        ),
      ...(w.wooden.n
        ? [
            `<span class="lens-chip">Wooden <small>${count(w.wooden.n)}</small> ${money(w.wooden.value - w.wooden.cost)}</span>`,
          ]
        : []),
    ].join("");
    const all = v.rows ?? [];
    const rows = all.slice(0, ROWS_SHOWN).map((p) => {
      const approx = p.approx ? "≈" : "";
      const got =
        p.source === "crafted"
          ? `craft ${gold(p.cost)}${approx}`
          : p.source === "opened"
            ? `${p.via === "case2" ? "elite" : "case"} ${gold(p.cost)}${approx}`
            : p.source === "bought"
              ? `buy ${gold(p.cost)}`
              : p.source === "looted"
                ? "loot"
                : `<span class="lens-muted" title="got before your history starts">–</span>`;
      const inBattle = p.worn && mode !== "war";
      const rough = /any stats/i.test(p.value?.label ?? "");
      const nowCell =
        p.fate === "sold"
          ? `sold ${gold(p.proceeds)}${p.sellsHours != null ? ` <small>· ${hoursWord(p.sellsHours)}</small>` : ""}`
          : p.fate === "scrapped"
            ? inBattle
              ? `<span class="lens-muted">in battle</span>`
              : `scrap ${gold(p.proceeds)}`
            : p.value?.value != null
              ? `<span title="${esc(p.value.label)}"${rough ? ' class="lens-muted"' : ""}>${rough ? "≈" : "~"}${gold(p.value.value)}</span>`
              : `<span class="lens-muted" title="reading the sales of these stats">…</span>`;
      const back = p.fate === "held" ? (p.value?.value ?? null) : p.proceeds;
      const pnl =
        !inBattle && back != null && p.cost != null ? back - p.cost : null;
      const when = new Date(p.goneAt ?? p.at ?? Date.now());
      const time = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
      const stats = statsWords(p.skills);
      return `<tr data-fate="${p.fate}" data-source="${p.source}"><td>${craftWindow === "today" ? "" : `<small>${esc(localDayOf(when.toISOString()).slice(5))}</small> `}${time}</td><td>${esc(itemLabel(p.code))}${stats ? ` <small>${esc(stats)}</small>` : ""}</td><td>${got}</td><td>${nowCell}</td><td class="lens-num">${pnl == null ? "" : money(pnl)}</td></tr>`;
    });
    const more = (v.rowsTotal ?? all.length) - rows.length;
    const list = rows.length
      ? `<table class="lens-crafts"><thead><tr><th>When</th><th>Piece</th><th>Cost</th><th>Now</th><th class="lens-num">±</th></tr></thead><tbody>${rows.join("")}</tbody></table>${more > 0 ? `<p class="lens-muted">+${count(more)} more</p>` : ""}`
      : `<p class="lens-muted">Nothing in this window.</p>`;
    return own(
      `${head}${tiles}${chips ? `<div class="lens-chips">${chips}</div>` : ""}${list}`,
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
  };
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
