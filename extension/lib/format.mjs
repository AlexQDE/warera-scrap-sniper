// @ts-check
/** @param {unknown} value */
export const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
const goldFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});
/** @param {unknown} v @param {number} [d] */
export const fmt = (v, d = 3) =>
  v == null || !Number.isFinite(Number(v))
    ? "–"
    : d === 3
      ? goldFormat.format(Number(v))
      : Number(v).toLocaleString("en-US", {
          minimumFractionDigits: d,
          maximumFractionDigits: d,
        });
/** @param {number | null | undefined} v @param {number} [d] */
export const signed = (v, d = 3) =>
  v == null ? "–" : `${v < 0 ? "−" : "+"}${fmt(Math.abs(v), d)}`;
/** @param {unknown} n */
export function fmtQty(n) {
  if (n == null || !Number.isFinite(Number(n))) return "–";
  const v = Number(n);
  return v >= 1e6
    ? `${(v / 1e6).toFixed(1)}M`
    : v >= 1e4
      ? `${Math.round(v / 1e3)}k`
      : v >= 1e3
        ? `${(v / 1e3).toFixed(1)}k`
        : String(Math.round(v));
}
/** @param {string | null | undefined} iso @param {number} [now] */
export function ago(iso, now = Date.now()) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60
    ? `${s}s ago`
    : s < 3600
      ? `${Math.floor(s / 60)}m ago`
      : `${Math.floor(s / 3600)}h ago`;
}
