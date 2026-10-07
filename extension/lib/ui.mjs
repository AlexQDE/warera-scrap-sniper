import { escapeHtml, ago } from "./format.mjs";

const lastHtml = new WeakMap();
/** What makes a control the same control after a rewrite: its action or field plus the code, id or type it carries. */
const controlKey = (node) =>
  ["action", "field", "code", "id", "type", "tab", "tier", "window"]
    .map((k) => node.dataset[k] ?? "")
    .join("\u0000");
/** Age labels ("12s ago") are kept current by clock(); a passing second must not count as new markup. */
const AGE_TEXT = /(<span data-lens-time="[^"]*">)[^<]*(<\/span>)/g;
export function setHtml(el, html) {
  const key = html.replace(AGE_TEXT, "$1$2");
  if (lastHtml.get(el) === key) return false;
  // Keep keyboard focus (and a text field's caret) on the same control across a rewrite.
  const active = el.contains(document.activeElement)
    ? document.activeElement
    : null;
  const focused =
    active?.dataset && (active.dataset.action || active.dataset.field)
      ? controlKey(active)
      : null;
  const caret =
    active && typeof active.selectionStart === "number"
      ? [active.selectionStart, active.selectionEnd]
      : null;
  el.innerHTML = html;
  if (focused) {
    const next = [...el.querySelectorAll("[data-action], [data-field]")].find(
      (node) => controlKey(node) === focused,
    );
    next?.focus({ preventScroll: true });
    if (next && caret && typeof next.setSelectionRange === "function")
      try {
        next.setSelectionRange(caret[0], caret[1]);
      } catch {
        /* a number field refuses a caret: keep focus only */
      }
  }
  lastHtml.set(el, key);
  return true;
}
export function panel(id, anchor, action) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("section");
    el.id = id;
    el.dataset.lens = "";
    el.addEventListener("click", action);
    anchor.insertAdjacentElement("beforebegin", el);
  } else if (!reaches(el.nextElementSibling, anchor))
    anchor.insertAdjacentElement("beforebegin", el);
  return el;
}
/** Only this extension's own panels may sit between a panel and its anchor; anything else means the page moved and the panel follows. */
export function reaches(from, anchor) {
  for (let n = from; n; n = n.nextElementSibling) {
    if (n === anchor) return true;
    if (!n.hasAttribute("data-lens")) return false;
  }
  return false;
}
export const timeLabel = (at, now = Date.now()) =>
  `<span data-lens-time="${escapeHtml(at)}">${escapeHtml(ago(at, now))}</span>`;
export function header(
  title,
  {
    at,
    now = Date.now(),
    status = "loading",
    collapsed = false,
    collapse = true,
    busy = false,
  } = {},
) {
  return `<header class="lens-head"><span class="lens-brand">◈ WarEra Plus</span><span class="lens-section">${escapeHtml(title)}</span><span class="lens-status" data-status="${escapeHtml(status)}">${escapeHtml(status)} ${at ? `· ${timeLabel(at, now)}` : ""}</span><span class="lens-grow"></span><button type="button" data-action="refresh" aria-label="Refresh ${escapeHtml(title)}" ${busy ? "disabled" : ""}>${busy ? "Reading…" : "↻ Refresh"}</button>${collapse ? `<button type="button" data-action="collapse" aria-expanded="${!collapsed}">${collapsed ? "Details" : "Compact"}</button>` : ""}</header>`;
}
export function notice(text, stale = false) {
  return `<div class="lens-notice" role="status">${escapeHtml(text)} <button type="button" data-action="${stale ? "reload" : "settings"}">${stale ? "Reload page" : "Settings"}</button></div>`;
}
export function clock(root = document, now = Date.now()) {
  for (const el of root.querySelectorAll("[data-lens-time]")) {
    const next = ago(el.dataset.lensTime, now);
    if (el.textContent !== next) el.textContent = next;
  }
}
