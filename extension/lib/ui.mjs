import { escapeHtml, ago } from "./format.mjs";

const lastHtml = new WeakMap();
export function setHtml(el, html) {
  if (lastHtml.get(el) === html) return false;
  const focused = el.contains(document.activeElement)
    ? document.activeElement?.dataset?.action
    : null;
  el.innerHTML = html;
  if (focused)
    [...el.querySelectorAll("[data-action]")]
      .find((node) => node.dataset.action === focused)
      ?.focus({ preventScroll: true });
  lastHtml.set(el, html);
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
  } else if (el.nextElementSibling !== anchor)
    anchor.insertAdjacentElement("beforebegin", el);
  return el;
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
  return `<header class="lens-head"><span class="lens-brand">◈ WarEra Lens</span><span class="lens-section">${escapeHtml(title)}</span><span class="lens-status" data-status="${escapeHtml(status)}">${escapeHtml(status)} ${at ? `· ${timeLabel(at, now)}` : ""}</span><span class="lens-grow"></span><button type="button" data-action="refresh" aria-label="Refresh ${escapeHtml(title)}" ${busy ? "disabled" : ""}>${busy ? "Reading…" : "↻ Refresh"}</button>${collapse ? `<button type="button" data-action="collapse" aria-expanded="${!collapsed}">${collapsed ? "Details" : "Compact"}</button>` : ""}</header>`;
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
