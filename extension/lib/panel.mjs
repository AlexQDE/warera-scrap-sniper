// The one bar WarEra Plus puts on the equipment market: a slim header with
// the live counts and three tabs (Market, Craft, Ledger), and under it one
// section at a time, none by default. The header is app.mjs's (it holds the
// whole state); the sections are rendered into `body` by equipment.mjs and
// craftdesk.mjs. Nothing here reads the game or the API.
import { escapeHtml as esc } from "./format.mjs";
import { timeLabel, reaches } from "./ui.mjs";

export const BAR_ID = "scrap-sniper-bar";
export const TABS = Object.freeze([
  { key: "market", label: "Market" },
  { key: "craft", label: "Craft" },
  { key: "ledger", label: "Ledger" },
]);

/**
 * The bar before `anchor`, created once with its head and body; follows the
 * anchor when the page moves it. Returns { bar, head, body }.
 */
export function mountBar(anchor, onClick) {
  let bar = document.getElementById(BAR_ID);
  if (!bar) {
    bar = document.createElement("section");
    bar.id = BAR_ID;
    bar.dataset.lens = "";
    bar.innerHTML =
      '<header class="lens-head"></header><div class="lens-body" hidden></div>';
    bar.addEventListener("click", onClick);
    anchor.insertAdjacentElement("beforebegin", bar);
  } else if (!reaches(bar.nextElementSibling, anchor))
    anchor.insertAdjacentElement("beforebegin", bar);
  return {
    bar,
    head: bar.querySelector(":scope > .lens-head"),
    body: bar.querySelector(":scope > .lens-body"),
  };
}

/**
 * The header line: brand, freshness, the market pulse (snipes / flips /
 * rows), the tabs and the refresh button.
 * @param {{ at?: string | null, now?: number, status?: string, busy?: boolean, panel?: string, tabs?: ReadonlyArray<string>, pulse?: string, setup?: boolean }} input
 */
export function headHtml({
  at = null,
  now = Date.now(),
  status = "loading",
  busy = false,
  panel = "none",
  tabs = TABS.map((t) => t.key),
  pulse = "",
  setup = false,
}) {
  const tabHtml = setup
    ? ""
    : TABS.filter((t) => tabs.includes(t.key))
        .map(
          (t) =>
            `<button type="button" data-action="tab" data-tab="${t.key}" aria-pressed="${panel === t.key}">${t.label}</button>`,
        )
        .join("");
  return `<span class="lens-brand">◈ WarEra Plus</span><span class="lens-status" data-status="${esc(status)}" title="prices ${esc(status)}">●${at ? ` ${timeLabel(at, now)}` : ` ${esc(status)}`}</span>${pulse ? `<span class="lens-pulse">${pulse}</span>` : ""}<span class="lens-grow"></span><nav class="lens-tabs">${tabHtml}</nav><button type="button" class="lens-refresh" data-action="refresh" aria-label="Refresh" title="Refresh" ${busy ? "disabled" : ""}>${busy ? "…" : "↻"}</button>`;
}
