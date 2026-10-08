// The Craft and Ledger sections of the bar. Craft: one row per tier, what a
// craft costs at the observed asks and what it is worth at the game's
// average item prices (craftboard.mjs). Ledger: the worker's view of the
// player's whole history (observed.mjs): the result by activity (crafting,
// cases, market buys, loot) and window, the recent pieces. Rendering only.
import { fmt, signed, escapeHtml as esc } from "./format.mjs";
import { setHtml, timeLabel } from "./ui.mjs";
import { freshness, TTL } from "./quality.mjs";
import { tierBoard, bestTier } from "./craftboard.mjs";
import { itemLabel, rarityFromItemCode } from "./dom.mjs";
import { comparableFills } from "./resale.mjs";
import { localDayOf } from "./observed.mjs";
import { spanWords } from "./similar.mjs";
import { WINDOW_HOURS } from "./similar.mjs";

const pct = (v, d = 0) => (v == null ? "–" : `${signed(v * 100, d)}%`);

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

  const cls = (v) => (v == null ? "" : v >= 0 ? "lens-pos" : "lens-neg");
  const hoursWord = (h) =>
    h == null ? "" : h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`;
  const statsWords = (skills) =>
    skills && Object.keys(skills).length
      ? spanWords(
          Object.fromEntries(
            Object.entries(skills).map(([k, v]) => [k, [v, v]]),
          ),
        )
      : "stats unknown";
  /** Today's money for the bar's head: what was sold or scrapped today against its cost. */
  function pulse(state) {
    const v = state.ledger;
    if (!v || !state.craftsUserId || v.meta?.userId !== state.craftsUserId)
      return "";
    const m = v.windows.today.money;
    const t = v.windows.today;
    const est = t.crafted.estimated + t.opened.estimated + t.bought.estimated;
    if (!m.n && !t.crafted.n && !t.opened.n && !t.bought.n) return "";
    return `today <b class="${cls(m.realized)}">${signed(m.realized)} g</b>${m.unknownCost ? "*" : ""} · est <b class="${cls(est)}">${signed(est)} g</b>`;
  }
  const WINDOWS = [
    ["today", "Today"],
    ["week", "7 days"],
    ["month", "30 days"],
    ["all", "All"],
  ];
  const SOURCES = [
    ["crafted", "Crafting", "craft"],
    ["opened", "Cases", "opening"],
    ["bought", "Market buys", "buy"],
    ["looted", "Battle loot", "drop"],
  ];

  function ledgerHtml(state) {
    const id = state.craftsUserId ?? null;
    const v = state.ledger;
    const h = state.history;
    const head = (sub, body) =>
      `<div class="lens-own"><p class="lens-own-head">${sub}</p>${body}</div>`;
    if (!id)
      return head(
        "account not found on this page",
        `<p class="lens-muted">The page did not show your own inventory or skills link, so your history cannot be read. Set your player id in the extension's settings (the 24 characters in your profile URL).</p>`,
      );
    if (!v || v.meta?.userId !== id)
      return head(
        state.historyError ? "read failed" : "reading…",
        `<p class="lens-muted">${state.historyError ? `Your history could not be read: ${esc(state.historyError)}. It retries on its own.` : h ? `Reading your history from the start of your profile: ${h.count} transactions so far.` : "Reading your history from the start of your profile."}</p>`,
      );
    const w = v.windows[craftWindow] ?? v.windows.today;
    const meta = v.meta;
    const filling = !meta.done
      ? ` · <b>filling from the start of your profile</b>: ${meta.count} transactions so far, back to ${esc(localDayOf(meta.oldestAt))}`
      : ` · since ${esc(localDayOf(meta.oldestAt))}, ${meta.count} transactions`;
    const who = meta.username
      ? esc(meta.username)
      : `player …${esc(String(id).slice(-6))}`;
    const m = w.money;
    const sources = SOURCES.map(([key, name, unit]) => {
      const o = w[key];
      if (!o?.n) return "";
      return `<tr><th scope="row">${name}</th><td class="lens-num">${o.n}</td><td class="lens-num">${fmt(o.cost)}${o.costUnknown ? `<small> ${o.costUnknown} ?</small>` : ""}</td><td class="lens-num">${fmt(o.proceeds)}<small> ${o.sold} sold · ${o.scrapped} scrapped</small></td><td class="lens-num">${o.held ? `${fmt(o.heldValue)}<small> ${o.held} held, ${o.heldPriced} priced</small>` : "–"}</td><td class="lens-num ${cls(o.realized)}">${signed(o.realized)}</td><td class="lens-num ${cls(o.estimated)}"><b>${signed(o.estimated)}</b>${o.estimatedKnown ? `<small> ${signed(o.estimated / o.estimatedKnown)} a ${unit}</small>` : ""}</td></tr>`;
    }).join("");
    const caseRows = Object.entries(w.cases)
      .map(
        ([code, o]) =>
          `<span class="lens-chip"><b>${esc(code === "case1" ? "Case" : code === "case2" ? "Elite Case" : code)}</b> ${o.n} · cost ${fmt(o.cost)} · <span class="${cls(o.estimated)}">${signed(o.estimated)} g</span></span>`,
      )
      .join("");
    const tierRows = Object.entries(w.tiers)
      .sort(
        (a, b) =>
          ["common", "uncommon", "rare", "epic", "legendary", "mythic"].indexOf(
            a[0],
          ) -
          ["common", "uncommon", "rare", "epic", "legendary", "mythic"].indexOf(
            b[0],
          ),
      )
      .map(
        ([tier, o]) =>
          `<span class="lens-chip"><b>${esc(tier)}</b> ${o.n} · cost ${fmt(o.cost)} · <span class="${cls(o.estimated)}">${signed(o.estimated)} g</span></span>`,
      )
      .join("");
    const windowWord = WINDOWS.find(([k]) => k === craftWindow)?.[1] ?? "Today";
    const total = ["crafted", "opened", "bought", "looted"].reduce(
      (sum, k) => sum + (w[k]?.estimated ?? 0),
      0,
    );
    const tiles = `<div class="lens-tiles"><div><small>Money · ${windowWord}</small><b class="${cls(m.realized)}">${signed(m.realized)} g</b><span>${m.n ? `${m.sold} sold, ${m.scrapped} scrapped · ${fmt(m.proceeds)} g in${m.unknownCost ? ` · ${m.unknownCost} without a cost on record` : ""}` : "nothing sold or scrapped"}</span></div><div><small>Got · ${windowWord}</small><b>${["crafted", "opened", "bought", "looted"].reduce((n, k) => n + (w[k]?.n ?? 0), 0)}</b><span>${w.crafted.n ?? 0} crafted · ${w.opened.n ?? 0} from cases · ${w.bought.n ?? 0} bought · ${w.looted.n ?? 0} looted</span></div><div><small>Result incl. held · ${windowWord}</small><b class="${cls(total)}">${signed(total)} g</b><span>gone at what they brought, held at what pieces of those stats sell for</span></div></div>`;
    const rows = (v.rows ?? []).map((p) => {
      const got =
        p.source === "crafted"
          ? `crafted <small>${p.cost == null ? "no price" : `${fmt(p.cost)} g${p.approx ? "≈" : ""}`}</small>`
          : p.source === "opened"
            ? `${esc(p.via === "case2" ? "elite case" : "case")} <small>${p.cost == null ? "no price" : `${fmt(p.cost)} g${p.approx ? "≈" : ""}`}</small>`
            : p.source === "bought"
              ? `bought <small>${fmt(p.cost)} g</small>`
              : p.source === "looted"
                ? `loot`
                : `<small>before your history</small>`;
      const nowCell =
        p.fate === "sold"
          ? `sold ${fmt(p.proceeds)} g <small>${p.sellsHours != null ? `after ${hoursWord(p.sellsHours)} listed` : ""}</small>`
          : p.fate === "scrapped"
            ? `scrapped <small>${fmt(p.proceeds)} g in scraps</small>`
            : p.value?.value != null
              ? `sells ~${fmt(p.value.value)} g <small>${esc(p.value.label)}</small>`
              : `<small>held, value not read yet</small>`;
      const back = p.fate === "held" ? (p.value?.value ?? null) : p.proceeds;
      const pnl = back != null && p.cost != null ? back - p.cost : null;
      const when = new Date(p.goneAt ?? p.at ?? Date.now());
      const time = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
      return `<tr data-fate="${p.fate}" data-source="${p.source}"><td>${craftWindow === "today" ? "" : `${esc(localDayOf(when.toISOString()))} `}${time}</td><td>${esc(itemLabel(p.code))}<br><small>${esc(statsWords(p.skills))}</small></td><td>${got}</td><td>${nowCell}</td><td class="lens-num ${cls(pnl)}">${pnl == null ? "–" : signed(pnl)}</td></tr>`;
    });
    return head(
      `<b>${who}</b>${filling} · updated ${timeLabel(meta.at ?? v.at, now())}${state.historyBusy ? " · reading" : ""}${state.historyError ? ` · <b>last read failed</b> (${esc(state.historyError)})` : ""}`,
      `<div class="lens-windows">${WINDOWS.map(([k, label]) => `<button type="button" data-action="desk-window" data-window="${k}" aria-pressed="${craftWindow === k}">${label}</button>`).join("")}</div>${tiles}${sources ? `<table class="lens-crafts lens-sources"><thead><tr><th>${windowWord}</th><th class="lens-num">Pieces</th><th class="lens-num">Cost</th><th class="lens-num">Sold / scrapped</th><th class="lens-num">Held</th><th class="lens-num">Realized</th><th class="lens-num">Incl. held</th></tr></thead><tbody>${sources}</tbody></table>` : ""}${caseRows ? `<div class="lens-chips"><small>Cases</small> ${caseRows}</div>` : ""}${tierRows ? `<div class="lens-chips"><small>Crafts by tier</small> ${tierRows}</div>` : ""}${w.wooden.n ? `<p class="lens-muted">${w.wooden.n} wooden cases gave resources worth ${fmt(w.wooden.value)} g.</p>` : ""}${rows.length ? `<table class="lens-crafts"><thead><tr><th>When</th><th>Piece</th><th>Got</th><th>Now</th><th class="lens-num">±</th></tr></thead><tbody>${rows.join("")}</tbody></table>${v.rowsTotal > rows.length ? `<p class="lens-muted">${v.rowsTotal - rows.length} more in this window.</p>` : ""}` : `<p class="lens-muted">Nothing of yours in this window.</p>`}<p class="lens-muted lens-legend">Your whole history is read once with your key, kept in this browser and extended every minute (every 15 s while the game's craft or case window is open). A craft costs its recipe at that day's scrap and steel prices (${s_steelWords(state)}); a case what it would have sold for that day; a purchase what you paid; loot nothing. A piece counts at its sale, its scraps at that day's price, or, while you hold it, what pieces of those stats sold for in the last 7 days (else the game's average).${v.approxBefore ? ` The game keeps 30 days of daily prices: costs before ${esc(v.approxBefore)} use the nearest day on record or your own trades (≈).` : ""} Days are your local days.</p>`,
    );
  }
  const s_steelWords = (state) =>
    state.settings?.craftSteelMode === "chosen"
      ? "chosen-slot steel, twice the fee"
      : "random-craft steel fee";

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
