// The Craft and Ledger sections of the bar. Craft: one row per tier, what a
// craft costs at the observed asks and what it is worth at the game's
// average item prices (craftboard.mjs). Ledger: the player's own crafts
// replayed from the feed (observed.mjs): cost at the craft day's averages,
// fate by item id, held pieces at what their roll clears at. Rendering only.
import { fmt, signed, escapeHtml as esc } from "./format.mjs";
import { setHtml, timeLabel } from "./ui.mjs";
import { freshness, TTL } from "./quality.mjs";
import { tierBoard, bestTier } from "./craftboard.mjs";
import { RARITIES } from "./items.mjs";
import { itemLabel, rarityFromItemCode } from "./dom.mjs";
import { comparableFills } from "./resale.mjs";
import {
  replayCrafts,
  craftsSummary,
  dayOf,
  COUNTED_FROM,
} from "./observed.mjs";
import { similarValue, WINDOW_HOURS } from "./similar.mjs";

const pct = (v, d = 0) => (v == null ? "–" : `${signed(v * 100, d)}%`);
/** The player's local calendar date, not the UTC one. */
const localDate = (iso) => new Date(iso).toLocaleDateString("en-CA");
const STAT_WORDS = {
  attack: "attack",
  criticalChance: "crit chance",
  criticalDamages: "crit damage",
  armor: "armor",
  precision: "precision",
  dodge: "dodge",
};
const LEDGER_ROWS = 40;

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

  function ledgerHtml(state, s) {
    const id = state.craftsUserId ?? null;
    const c = state.crafts;
    const head = (sub, body) =>
      `<div class="lens-own"><p class="lens-own-head">${sub}</p>${body}</div>`;
    if (!id)
      return head(
        "account not found on this page",
        `<p class="lens-muted">The page did not show your own inventory or skills link, so your crafts cannot be read. Set your player id in the extension's settings (the 24 characters in your profile URL).</p>`,
      );
    if (!c || c.userId !== id)
      return head(
        state.craftsError ? "read failed" : "reading…",
        `<p class="lens-muted">${state.craftsError ? `Your crafts could not be read: ${esc(state.craftsError)}. Refresh retries.` : "Reading your crafts, sales and dismantles from the game's feed."}</p>`,
      );
    const key = `${c.at}|${c.userId}|${s.craftSteelMode}`;
    if (replayMemo.key !== key) {
      replayMemo.key = key;
      replayMemo.entries = replayCrafts({
        crafts: c.crafts,
        sales: c.sales,
        dismantles: c.dismantles,
        me: c.userId,
        averages: c.averages,
        steelMode: s.craftSteelMode,
      }).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    }
    const entries = replayMemo.entries;
    const today = dayOf(new Date(now()).toISOString());
    const from =
      craftWindow === "7d"
        ? dayOf(new Date(now() - 6 * 86400e3).toISOString())
        : today;
    // The same number a row of this piece would show: the sales of its own stats in the last 7 days.
    const valueOf = (e) =>
      similarValue(
        e.code,
        e.skills,
        comparableFills(state.salesByCode?.[e.code]?.fills ?? [], {
          code: e.code,
          hours: WINDOW_HOURS,
          now: now(),
          state: null,
        }),
      );
    const sum = craftsSummary(entries, { from, to: today, valueOf });
    const shown = entries.filter((e) => e.day >= from && e.day <= today);
    // The sales that price the held pieces, asked for one item at a time as the rows' are.
    const want = [
      ...new Set(
        shown
          .filter(
            (e) =>
              e.fate === "held" &&
              RARITIES.indexOf(String(e.rarity)) >= COUNTED_FROM,
          )
          .map((e) => e.code),
      ),
    ].slice(0, 8);
    // Asked for on every render: a fresh read returns at once, a failed one waits out its retry window.
    for (const code of want) requestSales(code);
    const cls = (v) => (v == null ? "" : v >= 0 ? "lens-pos" : "lens-neg");
    const windowWord = craftWindow === "7d" ? "7 days" : "today";
    const tiles = `<div class="lens-tiles"><div><small>Realized · ${windowWord}</small><b class="${sum.goneKnown ? cls(sum.realized) : ""}">${sum.goneKnown ? `${signed(sum.realized)} g` : "–"}</b><span>${sum.goneKnown ? `${sum.sold} sold, ${sum.scrapped} scrapped${sum.realizedPct != null ? ` · ${pct(sum.realizedPct, 1)}` : ""}` : `nothing gone yet`}</span></div><div><small>Held at market</small><b class="${cls(sum.unrealized)}">${sum.unrealized != null ? `${signed(sum.unrealized)} g` : "–"}</b><span>${sum.held ? `${sum.covered === sum.held ? fmt(sum.atMarket) : `${fmt(sum.atMarket)} (${sum.covered} of ${sum.held} priced)`} g against ${fmt(sum.heldCost)} g of inputs` : "nothing held"}</span></div><div><small>Crafted · ${windowWord}</small><b>${sum.crafted}</b><span>${sum.counted} counted (epic and up)${sum.below ? ` · ${sum.below} below epic listed, not summed` : ""}</span></div></div>`;
    const rows = shown.slice(0, LEDGER_ROWS).map((e) => {
      const v = e.fate === "held" ? valueOf(e) : null;
      const stat =
        e.stat && e.skills?.[e.stat] != null
          ? `${STAT_WORDS[e.stat] ?? e.stat} ${e.skills[e.stat]}${e.slot === "weapon" && e.skills.attack != null ? ` · attack ${e.skills.attack}` : ""}`
          : "roll unknown";
      const worth =
        e.fate === "sold"
          ? `sold ${fmt(e.proceeds)} g`
          : e.fate === "scrapped"
            ? `scrapped${e.proceeds != null ? `: ${fmt(e.proceeds)} g in scraps` : ""}`
            : v?.value != null
              ? `clears ${fmt(v.value)} g <small>${esc(v.label)}</small>`
              : `<small>${state.salesErrors?.[e.code] ? "sales read failed" : state.salesByCode?.[e.code] ? esc(v?.label ?? "too few sales with these stats") : "reading sales…"}</small>`;
      const pnl =
        e.cost == null
          ? null
          : e.fate === "held"
            ? v?.value == null
              ? null
              : v.value - e.cost
            : e.proceeds == null
              ? null
              : e.proceeds - e.cost;
      const when = new Date(e.at);
      const time = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
      return `<tr data-fate="${e.fate}"><td>${craftWindow === "7d" ? `${esc(localDate(e.at))} ` : ""}${time}</td><td>${esc(itemLabel(e.code))}</td><td>${esc(stat)}</td><td class="lens-num">${e.cost == null ? "–" : fmt(e.cost)}</td><td>${worth}</td><td class="lens-num ${cls(pnl)}">${pnl == null ? "–" : signed(pnl)}</td></tr>`;
    });
    const covered =
      c.complete?.crafts && c.complete?.sales && c.complete?.dismantles;
    const who = c.username
      ? esc(c.username)
      : `player …${esc(String(id).slice(-6))}`;
    return head(
      `<b>${who}</b> · ${c.days} days of your feed · read ${timeLabel(c.at, now())}${state.craftsBusy ? " · refreshing" : ""}${state.craftsError ? ` · <b>last read failed</b> (${esc(state.craftsError)}): the last good read is shown` : ""}`,
      `<div class="lens-windows"><button type="button" data-action="desk-window" data-window="today" aria-pressed="${craftWindow !== "7d"}">Today</button><button type="button" data-action="desk-window" data-window="7d" aria-pressed="${craftWindow === "7d"}">7 days</button></div>${tiles}${rows.length ? `<table class="lens-crafts"><thead><tr><th>When</th><th>Item</th><th>Roll</th><th class="lens-num">Cost</th><th>Now</th><th class="lens-num">P&amp;L</th></tr></thead><tbody>${rows.join("")}</tbody></table>${shown.length > LEDGER_ROWS ? `<p class="lens-muted">${shown.length - LEDGER_ROWS} more not listed.</p>` : ""}` : `<p class="lens-muted">No crafts of yours ${craftWindow === "7d" ? "in the last 7 days" : "today (UTC)"} in the feed.</p>`}<p class="lens-muted lens-legend">Cost = the recipe at the craft day's average scrap and steel prices (${s.craftSteelMode === "chosen" ? "chosen-slot steel, twice the fee" : "random-craft steel fee"}; change it in settings) · clears = the median of the last 7 days' sales of the same stats (else similar stats) · fates joined to your sales and dismantles by item id · days are UTC${covered ? "" : " · the feed was not fully covered, older rows may be missing"}.</p>`,
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
  return { render, clear, reset, onClick };
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
