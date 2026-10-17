// The game's own case and craft dialogs, annotated: what opening this case
// or crafting this tier is worth right now, how the player's own openings
// and crafts of it have gone (today and on the whole history), and what the
// last one gave. Display only: a click on the game's button is observed,
// never made, and only asks the worker to read the history again soon.
import { signed, gold, signedGold, escapeHtml as esc } from "./format.mjs";
import { setHtml } from "./ui.mjs";
import {
  slotName,
  itemLabel,
  slotFromAlt,
  isItemImageAlt,
  selectedTileIndex,
} from "./dom.mjs";
import { WEAPONS, RARITIES } from "./items.mjs";
import { snapshotSummary, CASE_LABELS } from "./cases.mjs";
import { tierBoard } from "./craftboard.mjs";
import { spanWords, windowWords } from "./similar.mjs";

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

const CASE_IMAGES = ["case1", "case2", "woodenCase", "toolbox"];
/**
 * The case a dialog shows by its image (cases have no skins: the image is
 * named by the code), one of case1, case2, woodenCase, toolbox; null when the
 * dialog shows none of them.
 * @param {Element} dialog
 */
export function caseFromImage(dialog) {
  for (const img of dialog.querySelectorAll("img")) {
    const alt = img.getAttribute("alt") ?? "";
    if (CASE_IMAGES.includes(alt) && !img.closest("[data-lens]")) return alt;
  }
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
    if (open) {
      const text = lines.join(" ");
      const shown = caseFromImage(dialog);
      // v0.27's toolbox opens into a tool for an employee (OPEN buttons and odds too), and the wooden case is not
      // one of the two cases priced here: neither gets the case panel
      const other =
        (shown != null && shown !== "case1" && shown !== "case2") ||
        /random tool/i.test(text);
      if (
        !other &&
        (shown || /total cases opened/i.test(text) || caseFromOdds(lines))
      ) {
        const code = shown ?? caseFromOdds(lines);
        if (code) return { kind: "case", dialog, code, button: open };
      }
    }
    const craft = buttons.find((b) => /^craft\b/i.test(label(b)));
    if (craft && /^craft items$/i.test(lines[0] ?? "")) {
      const tier = craftTier(lines);
      if (tier)
        return {
          kind: "craft",
          dialog,
          tier,
          button: craft,
          slot: pickedSlot(dialog, tier, label(craft)),
        };
    }
  }
  return null;
}

/**
 * The slot picked in a craft dialog, as its code (boots5, tank), or null for
 * a random craft. The button reads CRAFT RANDOM until a slot is picked; the
 * picked slot's tile carries a class none of the other slot tiles has
 * (read live 2026-10-10).
 * @param {Element} dialog @param {string} tier @param {string} buttonLabel
 */
export function pickedSlot(dialog, tier, buttonLabel) {
  if (/^craft random/i.test(buttonLabel)) return null;
  const tiles = [...dialog.querySelectorAll("img")]
    .filter(
      (img) =>
        !img.closest("[data-lens]") &&
        isItemImageAlt(img.getAttribute("alt")) &&
        slotFromAlt(img.getAttribute("alt")),
    )
    .map((img) => {
      let tile = null;
      for (let e = img; e && e !== dialog; e = e.parentElement)
        if (getComputedStyle(e).backgroundImage !== "none") {
          tile = e;
          break;
        }
      return { img, tile: tile ?? img.parentElement?.parentElement ?? null };
    });
  if (tiles.length < 2) return null;
  const i = selectedTileIndex(tiles.map((t) => t.tile?.className ?? ""));
  if (i < 0) return null;
  const slot = slotFromAlt(tiles[i].img.getAttribute("alt"));
  if (!slot) return null;
  return WEAPONS.includes(slot) ? slot : `${slot}${RARITIES.indexOf(tier) + 1}`;
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
export function modeSwitch(mode, worn = 0) {
  const button = (m, label, title) =>
    `<button type="button" data-action="ledger-mode" data-mode="${m}" aria-pressed="${mode === m}" title="${title}">${label}</button>`;
  return `<span class="lens-mode" role="group" aria-label="Gear worn in battle">${button("eco", "Eco", `Eco: ${worn ? `${count(worn)} pieces worn in battle left out of your results` : "gear worn in battle is left out of your results"}`)}${button("war", "War", "War: gear worn in battle counts (contracts, bounties)")}</span>`;
}

/**
 * A held piece's value: no mark when it rests on sales of the same stats,
 * ≈ otherwise (similar stats; muted for any stats or the game's average),
 * the window it was read over small after it; the full basis on hover.
 */
export function valueHtml(v) {
  if (v?.value == null)
    return `<span class="lens-muted" title="reading the sales of these stats">…</span>`;
  const avg = v.level === "avg" || /game avg/i.test(v.label ?? "");
  const level =
    v.level ?? (avg || /any stats/i.test(v.label ?? "") ? "item" : "same");
  const faint = level === "item" || level === "avg";
  const when =
    v.hours != null ? windowWords(v.hours).replace(" ", "") : avg ? "avg" : "";
  return `<span title="${esc(v.detail ?? v.label ?? "")}"${faint ? ' class="lens-muted"' : ""}>${level === "same" ? "" : "≈"}${gold(v.value)}${when ? ` <small>${when}</small>` : ""}</span>`;
}

/** "snipers", "knives", "boots": a slot's name for several pieces. */
const plural = (name) =>
  name === "knife" ? "knives" : /s$/.test(name) ? name : `${name}s`;

/**
 * The mark of a craft charged the chosen slot's doubled steel, with how that
 * is known; nothing for a random craft or another source.
 */
export function chosenMark(p) {
  if (p?.source !== "crafted" || !p.chosen) return "";
  const how =
    p.chosenBy === "seen"
      ? "picked in the game's craft window"
      : p.chosenBy === "streak"
        ? `${p.streak ?? "several"} ${plural(slotName(p.code))} in a row: too many for a random craft`
        : "set in the extension's settings";
  return `<span class="lens-pick"${p.chosenBy === "seen" ? "" : ' data-guess=""'} title="${esc(`Sniper craft (slot chosen), twice the steel: ${how}`)}">◎</span>`;
}

/**
 * One piece: its slot and stats, then what it sells for (held), sold for or
 * scrapped for, and the result against its cost. In eco mode a piece worn
 * in battle says so and has no result.
 */
export function pieceHtml(p, mode = "eco") {
  if (!p) return "";
  const stats = statsWords(p.skills);
  // the mark sits inside the piece's name: the list lays a piece out in four columns
  const name = `<span class="lens-piece">${esc(slotName(p.code))}${chosenMark(p)}</span>${stats ? ` <small>${esc(stats)}</small>` : ""}`;
  if (p.worn && mode !== "war")
    return `${name} <span class="lens-muted">in battle</span>`;
  const v = p.fate === "held" ? p.value : null;
  const worth =
    p.fate === "sold"
      ? `sold ${gold(p.proceeds)}`
      : p.fate === "scrapped"
        ? `scrap ${gold(p.proceeds)}`
        : valueHtml(v);
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
  return `${result(o.estimatedKnown ? o.estimated : null)} g · ${what}${o.worn && mode !== "war" ? ` <small>· ${count(o.worn)} in battle</small>` : ""}`;
}

/** The panel's head: the answer to the window's question first; the Eco / War switch only when battle gear is in view. */
const head = (body, title, mode, worn) =>
  `<header class="lens-head"${title ? ` title="${esc(title)}"` : ""}><span class="lens-brand">◈</span>${body}<span class="lens-grow"></span>${worn ? modeSwitch(mode, worn) : ""}</header>`;
const line = (label, body, title = "") =>
  `<p class="lens-line"${title ? ` title="${esc(title)}"` : ""}><small>${label}</small> ${body}</p>`;
const TAG = {
  open: ["flip", "OPEN"],
  sell: ["hit", "SELL"],
  even: ["miss", "EVEN"],
};

/** Where the player's own results stand before the history view arrives: on the way, or never without a key. */
const waitingHtml = (needsKey) =>
  needsKey
    ? `<p class="lens-muted">Your results: your history needs your API key</p>`
    : `<p class="lens-muted">Reading your history…</p>`;

export function caseHtml({
  code,
  cases,
  avg,
  sellFrom,
  ledger,
  needsKey = false,
}) {
  const mode = ledger?.mode ?? "eco";
  const summary = cases?.books
    ? snapshotSummary({
        books: cases.books,
        avg: avg?.values ?? null,
        sellFrom,
      })
    : null;
  const row = summary?.rows.find((r) => r.code === code);
  const [kind, word] = TAG[row?.verdict] ?? TAG.even;
  const now = row
    ? `<span class="lens-section">Open ~${row.complete ? gold(row.openValue) : "–"} · Sell ${gold(row.bid)}</span> <span class="lens-tag" data-kind="${kind}">${word}</span>`
    : `<span class="lens-muted">Reading prices…</span>`;
  const w = ledger?.windows;
  const today = w?.today.cases[code];
  const all = w?.all.cases[code];
  const mine = w
    ? `${line("Today", outcomeLine(today, "opened", mode))}${line("All", outcomeLine(all, "opened", mode))}`
    : waitingHtml(needsKey);
  const last =
    ledger?.lastOpened && ledger.lastOpened.via === code
      ? line("Last", pieceHtml(ledger.lastOpened, mode))
      : "";
  const title = `${CASE_LABELS[code] ?? code}. Open: what a case gives at the scrap bids${row?.policy ? ` (drops sold from ${sellFrom} up)` : ""}. Sell: the best bid for the sealed case.`;
  return `${head(now, title, mode, today?.worn || all?.worn)}${mine}${last}`;
}

export function craftHtml({
  tier,
  slot = null,
  cases,
  avg,
  ledger,
  needsKey = false,
}) {
  const mode = ledger?.mode ?? "eco";
  const books = cases?.books ?? {};
  const rows = tierBoard({
    scrapAsks: books.scraps?.asks,
    scrapBids: books.scraps?.bids,
    steelAsks: books.steel?.asks,
    avg: avg?.values,
  });
  const r = rows.find((x) => x.rarity === tier);
  const w = ledger?.windows;
  const today = w?.today.tiers[tier];
  const all = w?.all.tiers[tier];
  const crafts = (ledger?.craftsToday ?? []).filter((p) => p.rarity === tier);
  const shown = crafts.slice(0, 8);
  const list = shown.length
    ? `<ul class="lens-list">${shown.map((p) => `<li>${pieceHtml(p, mode)}</li>`).join("")}${crafts.length > shown.length ? `<li class="lens-muted">+${crafts.length - shown.length} more</li>` : ""}</ul>`
    : "";
  const mine = w
    ? today
      ? `${line("Today", outcomeLine(today, "craft", mode))}${list}`
      : `<p class="lens-muted">No ${esc(tier)} crafts today</p>`
    : waitingHtml(needsKey);
  // a picked slot doubles the steel and is worth what that slot sells for; a random craft, the six at the game's odds
  const picked = slot ? r?.slots.find((s) => s.code === slot) : null;
  const cost = slot
    ? (r?.costChosen.value ?? null)
    : (r?.costRandom.value ?? null);
  const ev = slot ? (picked?.avg ?? null) : (r?.evRandom ?? null);
  const what = slot ? `Craft ${esc(slotName(slot))}` : "Craft now";
  const now =
    cost != null && ev != null
      ? `<span class="lens-section">${what}</span> <span class="lens-answer">${gold(cost)} → ${gold(ev)} · <b class="${cls(ev - cost)}">${signedGold(ev - cost)} g</b> (${signed(((ev - cost) / cost) * 100, 0)}%)</span>`
      : `<span class="lens-section">${what}</span> <span class="lens-muted">${r && ev == null ? (slot ? "no price for it yet" : `${r.covered}/6 slots priced`) : "reading prices…"}</span>`;
  const random =
    r?.costRandom.value != null && r.evRandom != null
      ? ` A random craft instead: ${gold(r.costRandom.value)} → ${gold(r.evRandom)} (${signed(r.roiRandom * 100, 0)}%).`
      : "";
  const title = !r
    ? ""
    : slot
      ? `A sniper craft of ${slotName(slot)} (the slot chosen): ${r.scraps} scraps + ${r.steelChosen} steel (twice the random fee) at the market asks, against the game's average price of ${itemLabel(slot)}.${random}`
      : `A random craft: ${r.scraps} scraps + ${r.steelRandom} steel at the market asks, against the game's average price of the six slots at the game's odds${r.lossRandom != null ? `. A bad roll scrapped at once gives ${gold(r.scrapsBack)} g back` : ""}.`;
  const total = all
    ? line(`All ${esc(tier)}`, outcomeLine(all, "craft", mode))
    : "";
  return `${head(now, title, mode, today?.worn || all?.worn)}${mine}${total}`;
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
  /**
   * The game's own button was clicked: observe only, the click goes on to the game. A craft press carries the
   * window's pick: chosen or random by the button's label (CRAFT or CRAFT RANDOM), the slot by its marked tile.
   */
  const onClick = (e) => {
    const button = e.target?.closest?.("button");
    if (!button || button.closest("[data-lens]")) return;
    const found = findDialog();
    const label = linesOf(button)[0] ?? "";
    if (
      found &&
      found.dialog.contains(button) &&
      /^(open|craft)\b/i.test(label)
    )
      onAction(
        found.kind,
        found.kind === "craft"
          ? {
              tier: found.tier,
              chosen: !/^craft random/i.test(label),
              slot: found.slot,
            }
          : null,
      );
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
      needsKey: state.hasKey === false,
    };
    setHtml(
      panel,
      found.kind === "case"
        ? caseHtml({ ...ctx, code: found.code })
        : craftHtml({ ...ctx, tier: found.tier, slot: found.slot }),
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
