// The game's own case and craft dialogs, annotated: what opening this case
// or crafting this tier is worth right now, how the player's own openings
// and crafts of it have gone (today and on the whole history), and what the
// last one gave. Display only: a click on the game's button is observed,
// never made, and only asks the worker to read the history again soon.
import { signed, gold, signedGold, escapeHtml as esc } from "./format.mjs";
import { setHtml } from "./ui.mjs";
import { slotName } from "./dom.mjs";
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
/** A result in gold, coloured; "–" when it cannot be told. */
const result = (v) =>
  v == null
    ? `<span class="lens-muted">–</span>`
    : `<b class="${cls(v)}">${signedGold(v)}</b>`;
const count = (n) => Number(n ?? 0).toLocaleString("en-US");

/** The Eco / War switch: whether gear worn in battle counts in the results. */
export function modeSwitch(mode) {
  const button = (m, label, title) =>
    `<button type="button" data-action="ledger-mode" data-mode="${m}" aria-pressed="${mode === m}" title="${title}">${label}</button>`;
  return `<span class="lens-mode" role="group" aria-label="Gear worn in battle">${button("eco", "Eco", "Eco: gear worn in battle is left out of your results")}${button("war", "War", "War: gear worn in battle counts (contracts, bounties)")}</span>`;
}

/**
 * One piece: its slot and stats, then what it sells for (held: sales of
 * those stats, ≈ when only the game's average is known), sold for or
 * scrapped for, and the result against its cost. In eco mode a piece worn
 * in battle says so and has no result.
 */
export function pieceHtml(p, mode = "eco") {
  if (!p) return "";
  const stats = statsWords(p.skills);
  const name = `<span class="lens-piece">${esc(slotName(p.code))}</span>${stats ? ` <small>${esc(stats)}</small>` : ""}`;
  if (p.worn && mode !== "war")
    return `${name} <span class="lens-muted">in battle</span>`;
  const v = p.fate === "held" ? p.value : null;
  const rough = /any stats/i.test(v?.label ?? "");
  const worth =
    p.fate === "sold"
      ? `sold ${gold(p.proceeds)}`
      : p.fate === "scrapped"
        ? `scrap ${gold(p.proceeds)}`
        : v?.value != null
          ? `<span title="${esc(v.label)}"${rough ? ' class="lens-muted"' : ""}>${rough ? "≈" : "~"}${gold(v.value)}</span>`
          : `<span class="lens-muted" title="reading the sales of these stats">…</span>`;
  const back = p.fate === "held" ? (v?.value ?? null) : (p.proceeds ?? null);
  const pnl = back != null && p.cost != null ? back - p.cost : null;
  return `${name} <span class="lens-worth">${worth}</span> ${result(pnl)}`;
}

/** "+312 g · 4 crafts · 2 in battle" for one outcome (observed.outcome). */
export function outcomeLine(o, unit, mode = "eco") {
  if (!o?.n && !o?.worn) return `none`;
  const n = o.n ?? 0;
  const what =
    unit === "opened"
      ? `${count(n)} opened`
      : `${count(n)} ${unit}${n === 1 ? "" : "s"}`;
  return `${result(o.estimatedKnown ? o.estimated : null)} g · ${what}${o.worn && mode !== "war" ? ` · ${count(o.worn)} in battle` : ""}`;
}

const head = (title, mode) =>
  `<header class="lens-head"><span class="lens-brand">◈</span><span class="lens-section">${esc(title)}</span><span class="lens-grow"></span>${modeSwitch(mode)}</header>`;
const line = (label, body, title = "") =>
  `<p class="lens-line"${title ? ` title="${esc(title)}"` : ""}><small>${label}</small> ${body}</p>`;
const TAG = {
  open: ["flip", "OPEN"],
  sell: ["hit", "SELL"],
  even: ["miss", "EVEN"],
};

export function caseHtml({ code, cases, avg, sellFrom, ledger }) {
  const mode = ledger?.mode ?? "eco";
  const summary = cases?.books
    ? snapshotSummary({
        books: cases.books,
        avg: avg?.values ?? null,
        sellFrom,
      })
    : null;
  const row = summary?.rows.find((r) => r.code === code);
  const label = CASE_LABELS[code] ?? code;
  const [kind, word] = TAG[row?.verdict] ?? TAG.even;
  const now = row
    ? `<p class="lens-line" title="Open: what a case gives at the scrap bids${row.policy ? ` (sold from ${esc(sellFrom)} up)` : ""}. Sell: the best bid for the sealed case.">Open <b>~${row.complete ? gold(row.openValue) : "–"}</b> · Sell <b>${gold(row.bid)}</b> <span class="lens-tag" data-kind="${kind}">${word}</span></p>`
    : `<p class="lens-muted">Reading prices…</p>`;
  const w = ledger?.windows;
  const mine = w
    ? `${line("Today", outcomeLine(w.today.cases[code], "opened", mode))}${line("All", outcomeLine(w.all.cases[code], "opened", mode))}`
    : `<p class="lens-muted">Reading your history…</p>`;
  const last =
    ledger?.lastOpened && ledger.lastOpened.via === code
      ? line("Last", pieceHtml(ledger.lastOpened, mode))
      : "";
  return `${head(label, mode)}${now}${mine}${last}`;
}

export function craftHtml({ tier, cases, avg, ledger }) {
  const mode = ledger?.mode ?? "eco";
  const books = cases?.books ?? {};
  const rows = tierBoard({
    scrapAsks: books.scraps?.asks,
    scrapBids: books.scraps?.bids,
    steelAsks: books.steel?.asks,
    avg: avg?.values,
  });
  const r = rows.find((x) => x.rarity === tier);
  const name = tier.charAt(0).toUpperCase() + tier.slice(1);
  const w = ledger?.windows;
  const today = w?.today.tiers[tier];
  const crafts = (ledger?.craftsToday ?? []).filter((p) => p.rarity === tier);
  const shown = crafts.slice(0, 8);
  const list = shown.length
    ? `<ul class="lens-list">${shown.map((p) => `<li>${pieceHtml(p, mode)}</li>`).join("")}${crafts.length > shown.length ? `<li class="lens-muted">+${crafts.length - shown.length} more</li>` : ""}</ul>`
    : "";
  const mine = w
    ? today
      ? `${line("Today", outcomeLine(today, "craft", mode))}${list}`
      : `<p class="lens-muted">No ${esc(tier)} crafts today</p>`
    : `<p class="lens-muted">Reading your history…</p>`;
  const now = r
    ? line(
        "Craft now",
        `${r.costRandom.value == null ? "–" : gold(r.costRandom.value)} → ${r.evRandom == null ? "–" : `~${gold(r.evRandom)}`} g${r.roiRandom != null ? ` <b class="${cls(r.roiRandom)}">${signed(r.roiRandom * 100, 0)}%</b>` : ""}`,
        `A random craft: ${r.scraps} scraps + ${r.steelRandom} steel at the market asks, against the game's average price of the six slots at the game's odds${r.evRandom == null ? ` (${r.covered}/6 priced)` : ""}${r.lossRandom != null ? `. A bad roll scrapped at once gives ${gold(r.scrapsBack)} g back` : ""}.`,
      )
    : "";
  const all = w?.all.tiers[tier];
  const total = all
    ? line(`All ${esc(tier)}`, outcomeLine(all, "craft", mode))
    : "";
  return `${head(`${name} craft`, mode)}${mine}${now}${total}`;
}

export function createDialogs({ onAction = () => {}, onMode = () => {} } = {}) {
  let current = null;
  /** The panel's own Eco / War switch: handled here, kept from the game's dialog. */
  const onPanelClick = (e) => {
    const button = e.target?.closest?.('[data-action="ledger-mode"]');
    if (!button) return;
    e.preventDefault();
    e.stopPropagation();
    onMode(button.dataset.mode === "war" ? "war" : "eco");
  };
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
  /** Annotate the open dialog, if any; returns { kind, root, tier } for the observer and the sales to read. */
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
      panel.addEventListener("click", onPanelClick);
      // a case dialog: before the box that holds both open buttons (full width); a craft dialog: before the row
      // its button shares with the game's other buttons, else before the button itself
      let anchor = found.button;
      if (found.kind === "craft") {
        for (
          let n = found.button.parentElement;
          n && n !== found.dialog;
          n = n.parentElement
        ) {
          const natives = [...n.querySelectorAll("button")].filter(
            (b) => !b.closest("[data-lens]"),
          );
          if (natives.length < 2) continue;
          if (!/craft items/i.test(n.textContent ?? "")) anchor = n;
          break;
        }
      }
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
    return {
      kind: found.kind,
      root: found.dialog,
      tier: found.kind === "craft" ? found.tier : null,
    };
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
