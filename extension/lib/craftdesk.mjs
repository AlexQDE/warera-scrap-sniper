// The Craft and Ledger sections of the bar. Craft: one row per tier, what a
// craft costs at the observed asks and what it is worth at the game's
// average item prices (craftboard.mjs). Ledger: the player's own pieces
// replayed from the worker's feed store (observed.mjs): crafted or bought,
// sold, scrapped or held, the day's result. Rendering only.
import { fmt, signed, escapeHtml as esc } from "./format.mjs";
import { setHtml, timeLabel } from "./ui.mjs";
import { freshness, TTL } from "./quality.mjs";
import { tierBoard, bestTier } from "./craftboard.mjs";
import { itemLabel, rarityFromItemCode } from "./dom.mjs";
import { comparableFills } from "./resale.mjs";
import { replayPieces, ledgerSummary, localDayOf } from "./observed.mjs";
import { similarValue, WINDOW_HOURS } from "./similar.mjs";

const pct = (v, d = 0) => (v == null ? "–" : `${signed(v * 100, d)}%`);
const STAT_WORDS = {
  attack: "attack",
  criticalChance: "crit chance",
  criticalDamages: "crit damage",
  armor: "armor",
  precision: "precision",
  dodge: "dodge",
};
const LEDGER_ROWS = 60;

export function createCraftDesk({
  settings,
  requestSales = () => {},
  now = Date.now,
}) {
  let tier = null; // the tier whose slots are opened on the craft board
  let craftWindow = "today"; // the window of the player's own crafts shown: today (UTC) or 7 days
  const replayMemo = { key: "", entries: [] };

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
      craftWindow = t.dataset.window === "7d" ? "7d" : "today";
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
    const avgFresh = freshness(avg?.at, TTL.avg, now()) === "fresh";
    const rows = tierBoard({
      scrapAsks: book?.asks,
      scrapBids: book?.bids,
      steelAsks: steel?.asks,
      avg: avg?.values,
    });
    const top = bestTier(rows);
    const prices = `<div class="lens-prices"><span>scraps <b>${fmt(book?.asks?.[0]?.price)}</b> ask · ${fmt(book?.bids?.[0]?.price)} bid${book ? ` · <span class="lens-status" data-status="${scrapFresh ? "fresh" : "stale"}">${timeLabel(book.at, now())}</span>` : " · no quote"}</span><span>steel <b>${fmt(steel?.asks?.[0]?.price)}</b> ask${state.cases ? ` · <span class="lens-status" data-status="${steelFresh ? "fresh" : "stale"}">${timeLabel(state.cases.at, now())}</span>` : " · no quote"}</span><span>values: the game's average per item${avg ? ` · <span class="lens-status" data-status="${avgFresh ? "fresh" : "stale"}">${timeLabel(avg.at, now())}</span>` : " · reading…"}</span></div>`;
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
            ? `<span class="lens-muted" title="observed asks do not cover ${esc(r.costRandom.missing.join(" and "))}">no depth</span>`
            : `${fmt(r.costRandom.value)}`;
        const ev =
          r.evRandom == null
            ? `<span class="lens-muted">${r.covered}/6 slots</span>`
            : fmt(r.evRandom);
        const best = r.best
          ? `${esc(itemLabel(r.best.code))} <small>${fmt(r.best.avg)}</small>`
          : `<span class="lens-muted">–</span>`;
        const main = `<tr class="lens-tier" data-rarity="${r.rarity}" aria-expanded="${open}"><th scope="row"><button type="button" data-action="desk-tier" data-tier="${r.tier}" aria-pressed="${open}">${r.rarity}</button></th>${cell(cost)}${cell(ev)}${roiCell(r.roiRandom)}<td>${best}</td>${roiCell(r.roiChosen)}</tr>`;
        if (!open) return main;
        const slots = r.slots
          .map(
            (sl) =>
              `<span class="lens-chip"><b>${esc(itemLabel(sl.code))}</b> ${sl.avg == null ? "–" : fmt(sl.avg)} <small>${Math.round(sl.odds * 100)}%</small></span>`,
          )
          .join("");
        const chosenCost =
          r.costChosen.value == null
            ? "no depth"
            : `${fmt(r.costChosen.value)} g`;
        const floor =
          r.lossRandom == null
            ? "the scrap bid is not deep enough to value a reroll"
            : `a roll scrapped at once gives ${fmt(r.scrapsBack)} g back at the bid, so a bad random roll really costs <b>${fmt(r.lossRandom)} g</b>`;
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
        const fillsLine = pickedTier
          ? sales
            ? `${esc(itemLabel(pickedTier))}: ${fills.length} sales in 7 d${fills.length ? ` · median ${fmt(median(fills.map((f) => f.price)))} g · ${fmt(Math.min(...fills.map((f) => f.price)))}–${fmt(Math.max(...fills.map((f) => f.price)))}` : ""} (selected in the grid)`
            : `${esc(itemLabel(pickedTier))}: reading its fills…`
          : "select an item of this tier in the grid for its same-roll fills";
        return `${main}<tr class="lens-tier-detail"><td colspan="6"><div class="lens-chips">${slots}</div><p>Recipe ${r.scraps} scraps + ${r.steelRandom} steel at random, ${r.steelChosen} steel for a chosen slot (${chosenCost}). Random EV = the six slots' averages at the game's odds (30% weapon, 14% each armour slot); ${floor}.</p><p class="lens-muted">${fillsLine}</p></td></tr>`;
      })
      .join("");
    const headline = top
      ? `<p class="lens-headline">Best now: <b>${top.row.rarity}</b> ${top.mode === "random" ? `at random, ROI ${pct(top.row.roiRandom)}` : `with ${esc(itemLabel(top.row.best?.code))} chosen, ROI ${pct(top.row.roiChosen)}`}</p>`
      : `<p class="lens-muted">No tier can be valued yet: it needs the scrap and steel asks and the game's average per item.</p>`;
    return `${prices}${headline}<table class="lens-board"><thead><tr><th>Tier</th><th class="lens-num">Cost</th><th class="lens-num">Random EV</th><th class="lens-num">ROI</th><th>Best slot</th><th class="lens-num">ROI</th></tr></thead><tbody>${body}</tbody></table><p class="lens-muted lens-legend">Cost = the tier's scraps and the steel fee walked through the observed asks (random craft; a chosen slot doubles the steel). Value = the game's "Current value" per item, a mean of recent sales of any roll; the market tax is the buyer's, so a listing is what you keep. Expected values, not promises.</p>`;
  }

  /** The pieces of the feed store, replayed once per store read and steel mode. */
  function piecesOf(state, s) {
    const f = state.feed;
    const key = `${f.at}|${f.userId}|${s.craftSteelMode}`;
    if (replayMemo.key !== key) {
      replayMemo.key = key;
      replayMemo.entries = replayPieces({
        crafts: f.rows?.crafts ?? [],
        sales: f.rows?.sales ?? [],
        dismantles: f.rows?.dismantles ?? [],
        me: f.userId,
        averages: f.averages,
        steelMode: s.craftSteelMode,
      });
    }
    return replayMemo.entries;
  }
  const cls = (v) => (v == null ? "" : v >= 0 ? "lens-pos" : "lens-neg");
  const hoursWord = (h) =>
    h == null ? "" : h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`;
  /** Today's result for the bar's head, from the store the tab holds. */
  function pulse(state) {
    const f = state.feed;
    if (!f || !state.craftsUserId || f.userId !== state.craftsUserId) return "";
    const today = localDayOf(new Date(now()).toISOString());
    const sum = ledgerSummary(piecesOf(state, settings()), {
      from: today,
      to: today,
      valueOf: () => null,
    });
    if (!sum.gone.n && !sum.crafted.n && !sum.bought.n) return "";
    return `today <b class="${sum.gone.known ? cls(sum.gone.realized) : ""}">${sum.gone.known ? `${signed(sum.gone.realized)} g` : "–"}</b>${sum.gone.unknownCost ? "*" : ""}`;
  }

  function ledgerHtml(state, s) {
    const id = state.craftsUserId ?? null;
    const f = state.feed;
    const head = (sub, body) =>
      `<div class="lens-own"><p class="lens-own-head">${sub}</p>${body}</div>`;
    if (!id)
      return head(
        "account not found on this page",
        `<p class="lens-muted">The page did not show your own inventory or skills link, so your transactions cannot be read. Set your player id in the extension's settings (the 24 characters in your profile URL).</p>`,
      );
    if (!f || f.userId !== id)
      return head(
        state.feedError ? "read failed" : "reading…",
        `<p class="lens-muted">${state.feedError ? `Your transactions could not be read: ${esc(state.feedError)}. Refresh retries.` : "Reading your crafts, purchases, sales and dismantles from the game's feed (the first read walks 7 days back)."}</p>`,
      );
    const pieces = piecesOf(state, s);
    const today = localDayOf(new Date(now()).toISOString());
    const from =
      craftWindow === "7d"
        ? localDayOf(new Date(now() - 6 * 86400e3).toISOString())
        : today;
    const valueOf = (p) =>
      similarValue(
        p.code,
        p.skills,
        comparableFills(state.salesByCode?.[p.code]?.fills ?? [], {
          code: p.code,
          hours: WINDOW_HOURS,
          now: now(),
          state: null,
        }),
      );
    const sum = ledgerSummary(pieces, { from, to: today, valueOf });
    const inWindow = (iso) => {
      const d = iso ? localDayOf(iso) : "";
      return d >= from && d <= today;
    };
    const shown = pieces
      .filter((p) => inWindow(p.goneAt) || inWindow(p.at))
      .sort(
        (x, y) =>
          Date.parse(y.goneAt ?? y.at ?? "") -
          Date.parse(x.goneAt ?? x.at ?? ""),
      );
    // The sales that price the held pieces, asked for on every render; a fresh read returns at once.
    const want = [
      ...new Set(pieces.filter((p) => p.fate === "held").map((p) => p.code)),
    ].slice(0, 8);
    for (const code of want) requestSales(code);
    const windowWord = craftWindow === "7d" ? "7 days" : "today";
    const g = sum.gone;
    const tiles = `<div class="lens-tiles"><div><small>Result · ${windowWord}</small><b class="${g.known ? cls(g.realized) : ""}">${g.known ? `${signed(g.realized)} g` : "–"}</b><span>${g.n ? `${g.sold} sold, ${g.scrapped} scrapped · ${fmt(g.proceeds)} g in${g.unknownCost ? ` · ${g.unknownCost} without a cost on record, not counted` : ""}` : "nothing sold or scrapped"}</span></div><div><small>Crafted · ${windowWord}</small><b>${sum.crafted.n}</b><span>${sum.crafted.n ? `${fmt(sum.crafted.cost)} g of inputs${sum.crafted.costKnown < sum.crafted.n ? ` (${sum.crafted.n - sum.crafted.costKnown} uncosted)` : ""} · ${sum.crafted.sold} sold for ${fmt(sum.crafted.soldProceeds)} g · ${sum.crafted.held} held · ${sum.crafted.scrapped} scrapped` : "no crafts"}</span></div><div><small>Bought · ${windowWord}</small><b>${sum.bought.n}</b><span>${sum.bought.n ? `for ${fmt(sum.bought.cost)} g · ${sum.bought.sold} sold for ${fmt(sum.bought.soldProceeds)} g · ${sum.bought.held} held` : "no purchases"}</span></div><div><small>Held now</small><b class="${cls(sum.held.unrealized)}">${sum.held.covered ? `~${fmt(sum.held.value)} g` : "–"}</b><span>${sum.held.n ? `${sum.held.n} piece${sum.held.n === 1 ? "" : "s"}, ${sum.held.covered} priced by their stats · ${fmt(sum.held.cost)} g in${sum.held.unrealized != null ? ` · ${signed(sum.held.unrealized)} g if sold at that` : ""}` : "nothing held"}</span></div></div>`;
    const rows = shown.slice(0, LEDGER_ROWS).map((p) => {
      const v = p.fate === "held" ? valueOf(p) : null;
      const stat =
        p.skills && Object.keys(p.skills).length
          ? Object.entries(p.skills)
              .map(([k, val]) => `${STAT_WORDS[k] ?? k} ${val}`)
              .join(" · ")
          : "stats unknown";
      const got =
        p.source === "crafted"
          ? `crafted <small>${p.cost == null ? "no day average" : `${fmt(p.cost)} g`}</small>`
          : p.source === "bought"
            ? `bought <small>${fmt(p.cost)} g</small>`
            : `<small>before the feed on record</small>`;
      const nowCell =
        p.fate === "sold"
          ? `sold ${fmt(p.proceeds)} g <small>${p.sellsHours != null ? `after ${hoursWord(p.sellsHours)} listed` : ""}</small>`
          : p.fate === "scrapped"
            ? `scrapped${p.proceeds != null ? ` <small>${fmt(p.proceeds)} g in scraps</small>` : ""}`
            : v?.value != null
              ? `sells ~${fmt(v.value)} g <small>${esc(v.label)}</small>`
              : `<small>${state.salesErrors?.[p.code] ? "sales read failed" : state.salesByCode?.[p.code] ? esc(v?.label ?? "too few sales with these stats") : "reading sales…"}</small>`;
      const pnl =
        p.cost == null
          ? null
          : p.fate === "held"
            ? v?.value == null
              ? null
              : v.value - p.cost
            : p.proceeds == null
              ? null
              : p.proceeds - p.cost;
      const when = new Date(p.goneAt ?? p.at ?? now());
      const time = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
      return `<tr data-fate="${p.fate}" data-source="${p.source}"><td>${craftWindow === "7d" ? `${esc(localDayOf(when.toISOString()))} ` : ""}${time}</td><td>${esc(itemLabel(p.code))}<br><small>${esc(stat)}</small></td><td>${got}</td><td>${nowCell}</td><td class="lens-num ${cls(pnl)}">${pnl == null ? "–" : signed(pnl)}</td></tr>`;
    });
    const since = Object.values(f.covered ?? {})
      .filter(Boolean)
      .sort()
      .at(-1);
    const holes = Object.entries(f.holes ?? {})
      .filter(([, h]) => h)
      .map(([k]) => k);
    const who = f.username
      ? esc(f.username)
      : `player …${esc(String(id).slice(-6))}`;
    return head(
      `<b>${who}</b> · feed on record since ${since ? esc(localDayOf(since)) : "–"} · updated ${timeLabel(f.at, now())}${state.feedBusy ? " · refreshing" : ""}${state.feedError ? ` · <b>last read failed</b> (${esc(state.feedError)}): the last good read is shown` : ""}`,
      `<div class="lens-windows"><button type="button" data-action="desk-window" data-window="today" aria-pressed="${craftWindow !== "7d"}">Today</button><button type="button" data-action="desk-window" data-window="7d" aria-pressed="${craftWindow === "7d"}">7 days</button></div>${tiles}${rows.length ? `<table class="lens-crafts"><thead><tr><th>When</th><th>Piece</th><th>Got</th><th>Now</th><th class="lens-num">±</th></tr></thead><tbody>${rows.join("")}</tbody></table>${shown.length > LEDGER_ROWS ? `<p class="lens-muted">${shown.length - LEDGER_ROWS} more not listed.</p>` : ""}` : `<p class="lens-muted">Nothing of yours ${craftWindow === "7d" ? "in the last 7 days" : "today"}: no craft, purchase, sale or dismantle in the feed.</p>`}<p class="lens-muted lens-legend">Read from the game's transaction feed with your key, polled every minute while this page is open. A craft costs the recipe at the craft day's average scrap and steel prices (${s.craftSteelMode === "chosen" ? "chosen-slot steel, twice the fee" : "random-craft steel fee"}; change it in settings); a purchase costs what you paid; a sale is joined to the piece by its item id; "sells" is the median of the last 7 days' sales of the same stats. Days are your local days.${holes.length ? ` The ${holes.join(", ")} feed was not fully covered: older rows may be missing.` : ""}</p>`,
    );
  }

  /** Render `section` ("craft" or "ledger") into the bar's body. */
  function render(body, state, section) {
    const s = settings();
    const html =
      section === "ledger" ? ledgerHtml(state, s) : craftHtml(state, s);
    setHtml(
      body,
      `<div class="lens-desk" data-section="${section}">${html}</div>`,
    );
  }
  return { render, clear, reset, onClick, pulse };
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
