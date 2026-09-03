// Statistics over one item's recent market fills (what pieces really sold
// for), as fetched by api.mjs::fetchSales. Pure; the toolbar renders the result.

/**
 * @param fills  [{ price, at, state }] - price as paid, at as ISO time
 * @param hours  the window, default 72 h back from `now`
 * @param floor  the scrap value the fills are compared with (null = skip)
 */
export function salesStats(fills, { hours = 72, now = Date.now(), floor = null } = {}) {
  const cutoff = now - hours * 3600e3;
  const inWindow = (fills ?? [])
    .filter((f) => Number.isFinite(f?.price) && Date.parse(f.at) >= cutoff)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)); // newest first
  const prices = inWindow.map((f) => f.price).sort((a, b) => a - b);
  const n = prices.length;
  const median = n === 0 ? null : n % 2 ? prices[(n - 1) / 2] : (prices[n / 2 - 1] + prices[n / 2]) / 2;
  const oldest = inWindow.length ? Date.parse(inWindow[inWindow.length - 1].at) : null;
  return {
    count: n,
    spanHours: oldest == null ? 0 : (now - oldest) / 3600e3,   // how far back the fills actually reach
    low: n ? prices[0] : null,
    high: n ? prices[n - 1] : null,
    median,
    last: inWindow[0] ?? null,
    lastHour: inWindow.filter((f) => Date.parse(f.at) >= now - 3600e3).length,
    underFloor: floor == null ? 0 : inWindow.filter((f) => f.price <= floor).length,
    recent: inWindow.slice(0, 10),
  };
}
