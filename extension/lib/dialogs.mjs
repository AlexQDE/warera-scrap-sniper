// The game's own case and craft dialogs, annotated: what opening this case
// or crafting this tier is worth right now, how the player's own openings
// and crafts of it have gone (today and on the whole history), and what the
// last one gave. Display only: a click on the game's button is observed,
// never made, and only asks the worker to read the history again soon.
import { fmt, signed, escapeHtml as esc } from "./format.mjs";
import { setHtml } from "./ui.mjs";
import { itemLabel } from "./dom.mjs";
import { snapshotSummary, CASE_LABELS } from "./cases.mjs";
import { tierBoard } from "./craftboard.mjs";
import { spanWords } from "./similar.mjs";

export const PANEL_CLASS = "ss-dialog";
const RARITY_RE = /^(mythic|legendary|epic|rare|uncommon|common)$/i;

const linesOf = (el) =>
  String(el?.innerText ?? el?.textContent ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
/** The game's text, without the lines of the extension's own panel. */
const nativeLines = (dialog) => {
  const own = new Set(
    [...dialog.querySelectorAll("[data-lens]")].flatMap((el) => linesOf(el)),
  );
  return linesOf(dialog).filter((l) => !own.has(l));
};

/**
 * Which case an "open case" dialog is for, from the odds it prints: the
 * normal case drops commons (62%), the elite case none. null when unsure.
 * @param {ReadonlyArray<string>} lines
 */
export function caseFromOdds(lines) {
  const text = lines.join(" ");
  const pct = (name) => {
    const m = new RegExp(`([\\d.]+)%\\s*${name}`, "i").exec(text);
    return m ? Number(m[1]) : null;
  };
  const common = pct("Common");
  const mythic = pct("Mythic");
  if (common != null && common > 0) return "case1";
  if (mythic != null && (common == null || common === 0)) return "case2";
  return null;
}

/**
 * The tier a "craft items" dialog has selected: the dialog lists the six
 * tiers as tiles (a name and two numbers each), then the selected tier's
 * name as a heading.
 * @param {ReadonlyArray<string>} lines
 */
export function craftTier(lines) {
  const names = lines.filter((l) => RARITY_RE.test(l));
  const heading = names.length > 6 ? names[6] : null;
  return heading ? heading.toLowerCase() : null;
}

/** The game's case or craft dialog on the page, with what it is for. */
export function findDialog(root = document) {
  for (const dialog of root.querySelectorAll('[role="dialog"]')) {
    const buttons = [...dialog.querySelectorAll("button")].filter(
      (b) => !b.closest("[data-lens]"),
    );
    const label = (b) => linesOf(b)[0] ?? "";
    const lines = nativeLines(dialog);
    const open = buttons.find((b) => /^open\b/i.test(label(b)));
    if (
      open &&
      (/total cases opened/i.test(lines.join(" ")) || caseFromOdds(lines))
    ) {
      const code = caseFromOdds(lines);
      if (code) return { kind: "case", dialog, code, button: open };
    }
    const craft = buttons.find((b) => /^craft\b/i.test(label(b)));
    if (craft && /^craft items$/i.test(lines[0] ?? "")) {
      const tier = craftTier(lines);
      if (tier) return { kind: "craft", dialog, tier, button: craft };
    }
  }
  return null;
}

/** "atk 270 · crit 50%" for a piece's stats. */
const statsWords = (skills) =>
  skills && Object.keys(skills).length
    ? spanWords(
        Object.fromEntries(Object.entries(skills).map(([k, v]) => [k, [v, v]])),
      )
    : "";
const cls = (v) => (v == null ? "" : v >= 0 ? "lens-pos" : "lens-neg");
const money = (v) =>
  v == null ? "–" : `<b class="${cls(v)}">${signed(v)} g</b>`;

/** One piece the player just got, and what it is worth or what became of it. */
export function lastLine(p, word) {
  if (!p) return "";
  const stats = statsWords(p.skills);
  const worth =
    p.fate === "sold"
      ? `sold for ${fmt(p.proceeds)} g`
      : p.fate === "scrapped"
        ? `scrapped for ${fmt(p.proceeds)} g in scraps`
        : p.value?.value != null
          ? `sells ~${fmt(p.value.value)} g <small>${esc(p.value.label)}</small>`
          : "its value is being read";
  const back =
    p.fate === "held" ? (p.value?.value ?? null) : (p.proceeds ?? null);
  const result = back != null && p.cost != null ? back - p.cost : null;
  return `<p><small>${word}</small> <b>${esc(itemLabel(p.code))}</b>${stats ? ` · ${esc(stats)}` : ""} → ${worth}${p.cost != null ? ` · cost ${fmt(p.cost)} g${p.approx ? "≈" : ""}` : ""}${result != null ? ` · ${money(result)}` : ""}</p>`;
}

/** "N · cost · got · result" for one outcome (observed.outcome). */
export function outcomeLine(o, unit) {
  if (!o?.n) return `none`;
  const got = o.proceeds + o.heldValue;
  const per = o.estimatedKnown ? o.estimated / o.estimatedKnown : null;
  return `${o.n} ${unit}${o.n === 1 ? "" : "s"} · cost ${fmt(o.cost)} g · got ${fmt(got)} g${o.held ? ` (${o.held} held, ${o.heldPriced} priced)` : ""} → ${money(o.estimated)}${per != null ? ` <small>${signed(per)} g each</small>` : ""}`;
}

export function caseHtml({ code, cases, avg, sellFrom, ledger }) {
  const summary = cases?.books
    ? snapshotSummary({
        books: cases.books,
        avg: avg?.values ?? null,
        sellFrom,
      })
    : null;
  const row = summary?.rows.find((r) => r.code === code);
  const label = CASE_LABELS[code] ?? code;
  const now = row
    ? `<p>Opening is worth <b>~${row.complete ? fmt(row.openValue) : "–"} g</b> a case <small>${esc(row.policy ? `scrap below ${sellFrom}, sell from it` : "at the scrap bids")}</small> · it sells now for <b>${fmt(row.bid)} g</b> (best bid) → <span class="lens-tag" data-kind="${row.verdict === "open" ? "flip" : row.verdict === "sell" ? "hit" : "miss"}">${row.verdict === "open" ? "OPEN" : row.verdict === "sell" ? "SELL" : "EVEN"}</span></p>`
    : `<p class="lens-muted">Reading the case and scrap books…</p>`;
  const w = ledger?.windows;
  const mine = w
    ? `<p><small>Your ${esc(label)}s today</small> ${outcomeLine(w.today.cases[code], "opening")}</p><p><small>All your ${esc(label)}s</small> ${outcomeLine(w.all.cases[code], "opening")}</p>`
    : `<p class="lens-muted">Reading your history…</p>`;
  const last =
    ledger?.lastOpened && ledger.lastOpened.via === code
      ? lastLine(ledger.lastOpened, "Last opened")
      : "";
  return `<header class="lens-head"><span class="lens-brand">◈ WarEra Plus</span><span class="lens-section">${esc(label)}</span></header>${now}${mine}${last}<p class="lens-muted lens-legend">A case costs what it would have sold for that day; what came out counts at its sale, its scraps, or what a piece of those stats sells for.</p>`;
}

export function craftHtml({ tier, cases, avg, ledger }) {
  const books = cases?.books ?? {};
  const rows = tierBoard({
    scrapAsks: books.scraps?.asks,
    scrapBids: books.scraps?.bids,
    steelAsks: books.steel?.asks,
    avg: avg?.values,
  });
  const r = rows.find((x) => x.rarity === tier);
  const name = tier.charAt(0).toUpperCase() + tier.slice(1);
  const now = r
    ? `<p>A random ${tier} craft costs <b>${r.costRandom.value == null ? "–" : `${fmt(r.costRandom.value)} g`}</b> now <small>${r.scraps} scraps + ${r.steelRandom} steel at the asks</small> · it is worth <b>${r.evRandom == null ? `– (${r.covered}/6 slots priced)` : `~${fmt(r.evRandom)} g`}</b> <small>the six slots' game averages at the game's odds</small>${r.roiRandom != null ? ` → <b class="${cls(r.roiRandom)}">${signed(r.roiRandom * 100, 0)}%</b>` : ""}${r.lossRandom != null ? ` · a roll scrapped at once gives ${fmt(r.scrapsBack)} g back` : ""}</p>`
    : "";
  const w = ledger?.windows;
  const mine = w
    ? `<p><small>Your ${tier} crafts today</small> ${outcomeLine(w.today.tiers[tier], "craft")}</p><p><small>All your ${tier} crafts</small> ${outcomeLine(w.all.tiers[tier], "craft")}</p>`
    : `<p class="lens-muted">Reading your history…</p>`;
  const last =
    ledger?.lastCrafted && ledger.lastCrafted.rarity === tier
      ? lastLine(ledger.lastCrafted, "Last craft")
      : ledger?.lastCrafted
        ? lastLine(ledger.lastCrafted, "Last craft (other tier)")
        : "";
  return `<header class="lens-head"><span class="lens-brand">◈ WarEra Plus</span><span class="lens-section">${esc(name)} craft</span></header>${now}${mine}${last}<p class="lens-muted lens-legend">A craft costs its recipe at that day's scrap and steel prices; a piece counts at its sale, its scraps, or what a piece of those stats sells for.</p>`;
}

export function createDialogs({ onAction = () => {} } = {}) {
  let current = null;
  /** The game's own button was clicked: observe only, the click goes on to the game. */
  const onClick = (e) => {
    const button = e.target?.closest?.("button");
    if (!button || button.closest("[data-lens]")) return;
    const found = findDialog();
    if (
      found &&
      found.dialog.contains(button) &&
      /^(open|craft)\b/i.test(linesOf(button)[0] ?? "")
    )
      onAction(found.kind);
  };
  document.addEventListener("click", onClick, true);
  function clear() {
    for (const el of document.querySelectorAll(`.${PANEL_CLASS}`)) el.remove();
    current = null;
  }
  /** Annotate the open dialog, if any; returns { kind, root } for the observer. */
  function render(state) {
    const found = findDialog();
    if (!found) {
      clear();
      return null;
    }
    let panel = found.dialog.querySelector(`.${PANEL_CLASS}`);
    if (!panel) {
      clear();
      panel = document.createElement("div");
      panel.className = PANEL_CLASS;
      panel.dataset.lens = "";
      // a case dialog: before the box that holds both open buttons (full width); a craft dialog: before its button
      let anchor = found.button;
      if (found.kind === "case") {
        const opens = [...found.dialog.querySelectorAll("button")].filter(
          (btn) =>
            !btn.closest("[data-lens]") &&
            /^open\b/i.test(linesOf(btn)[0] ?? ""),
        );
        const common = (x, y) => {
          const up = new Set();
          for (let n = x; n; n = n.parentElement) up.add(n);
          for (let n = y; n; n = n.parentElement) if (up.has(n)) return n;
          return null;
        };
        const box = opens.reduce(
          (acc, btn) => (acc ? common(acc, btn) : btn),
          null,
        );
        if (box && box !== found.dialog && found.dialog.contains(box))
          anchor = box;
      }
      anchor.insertAdjacentElement("beforebegin", panel);
    }
    const ctx = {
      cases: state.cases,
      avg: state.avg,
      sellFrom: state.settings?.sellFrom ?? "epic",
      ledger: state.ledger,
    };
    setHtml(
      panel,
      found.kind === "case"
        ? caseHtml({ ...ctx, code: found.code })
        : craftHtml({ ...ctx, tier: found.tier }),
    );
    current = found;
    return { kind: found.kind, root: found.dialog };
  }
  return {
    render,
    clear,
    dispose() {
      document.removeEventListener("click", onClick, true);
      clear();
    },
    get current() {
      return current;
    },
  };
}
