// HTML for the case strip (open or sell) and the trip line under the map's
// "Nearest wooden case". Pure string builders over lib/cases.mjs numbers, so
// vitest reads what the page will show. Every string that comes from the API
// goes through escapeHtml before it lands here.
import { casesSummary, tripCost, SELL_MARGIN, CASE_ODDS } from './cases.mjs';

/** Gold with 3 decimals, the market's precision; '–' for nothing. */
export const fmt = (v, d = 3) => (v == null || !Number.isFinite(Number(v)) ? '–' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const signed = (v, d = 3) => (v == null ? '–' : (v < 0 ? '−' : '+') + fmt(Math.abs(v), d));
export const fmtQty = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '–';
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${Math.round(v / 1e3)}k`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
};
export const ago = (iso, now = Date.now()) => {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};

const pct = (m) => Math.round((m - 1) * 100);

/** The tag and the one-line reason for a verdict. */
export function verdictTag(verdict, ratio) {
  switch (verdict) {
    case 'sell': return { text: 'SELL', cls: 'ss-tag-sell', why: `the sealed bid clears the open value by ${pct(SELL_MARGIN)}%+` };
    case 'open': return { text: 'OPEN', cls: 'ss-tag-open', why: `opening beats the sealed bid by ${pct(SELL_MARGIN)}%+` };
    case 'even': return { text: 'EVEN', cls: 'ss-tag-even', why: `within ${pct(SELL_MARGIN)}% either way: open it for the XP, or sell for sure gold` };
    default: return { text: '?', cls: 'ss-tag-none', why: ratio == null ? 'no price yet' : '' };
  }
}

/**
 * The strip's inner HTML from a cases read ({ at, books, source, avg, avgAt,
 * avgError }) and the page state. `notice` (already escaped) replaces the
 * rows when the key is missing, rejected, or the script is stale.
 */
export function casesStripHtml({ cases, error = null, notice = null, busy = false, now = Date.now() }) {
  const head = (live, title) => `
    <div class="ss-head">
      <div class="ss-brand"><span class="ss-logo">⚒</span><span>Scrap Sniper · cases</span></div>
      <div class="ss-live" data-stale="${error || !cases?.at ? '1' : '0'}" title="${title}"><span class="ss-pulse"></span><span class="ss-live-text">${live}</span></div>
      <div class="ss-grow"></div>
      <button type="button" class="ss-icon ss-c-refresh${busy ? ' ss-busy' : ''}" title="Read the case prices again">↻</button>
    </div>`;
  if (notice) return head('setup', 'Open the extension settings.') + `<div class="ss-c-notice">${notice}</div>`;
  if (!cases?.at) return head(error ? 'read failed' : 'reading the case prices…', error ?? 'One call for the three cases, the twenty resources a wooden case pays, scraps and oil.');
  const s = casesSummary({ books: cases.books, avg: cases.avg });
  const rows = s.rows.map((r) => {
    const tag = verdictTag(r.verdict, r.ratio);
    let openSub;
    if (r.code === 'woodenCase') {
      openSub = r.complete
        ? `resources at bid · band ${fmt(r.openBand[0], 2)}–${fmt(r.openBand[1], 2)}`
        : `<span class="ss-warn">some resources unpriced</span>`;
    } else {
      const scrap = `scrap ${fmt(r.openScrap)}`;
      const market = r.openMarket == null ? 'avg items –' : `avg items ${fmt(r.openMarket)}`;
      openSub = `${scrap} · ${market}${r.complete ? '' : ' <span class="ss-warn">(partial)</span>'}`;
    }
    return `
      <div class="ss-c-row" data-verdict="${r.verdict ?? 'none'}">
        <div class="ss-c-name">${r.label}</div>
        <div class="ss-c-col" title="Highest buy order for the sealed case: what it fetches sold at once"><span class="ss-label">sealed bid</span><b>${fmt(r.bid)}</b><span class="ss-sub">${r.bid == null ? 'no buy orders' : `${fmtQty(r.bidQty)} wanted`} · ask ${fmt(r.ask)}</span></div>
        <div class="ss-c-col" title="${r.code === 'woodenCase' ? 'Tier odds 65/20/13/2, a 20–80 point budget, every resource at its best bid' : `${CASE_ODDS[r.code].scrapsPerCase} scraps per open (audited) × the scrap bid, or the drop sold at the game’s Current value; the better of the two counts`}"><span class="ss-label">opens for</span><b>${fmt(r.openValue)}</b><span class="ss-sub">${openSub}</span></div>
        <div class="ss-c-col"><span class="ss-label">bid vs open</span><b>${r.ratio == null ? '–' : `${fmt(r.ratio, 2)}×`}</b><span class="ss-sub">${r.bid != null && r.openValue != null ? signed(r.bid - r.openValue) : ''}</span></div>
        <div class="ss-c-verdict"><span class="ss-tag ${tag.cls}">${tag.text}</span><span class="ss-sub">${tag.why}</span></div>
      </div>`;
  }).join('');
  // "Current value" checked against the 72 h fills of eight codes on 2026-09-16:
  // it tracks the MEAN of real sales (helmet3 14.39 vs 14.25, jet 447.8 vs 456.0),
  // which sits 0-24% above the median, so it is a realized price, a touch optimistic.
  const avgNote = cases.avg
    ? `avg items = the game's Current value (a mean of recent sales, a few % above the median), read ${ago(cases.avgAt, now)}${cases.avgError ? ` <span class="ss-warn">(refresh failed: ${cases.avgError})</span>` : ''}`
    : `avg item prices not read${cases.avgError ? ` (${cases.avgError})` : ''}: opens valued at the scrap floor`;
  const live = error ? `read failed · showing ${ago(cases.at, now)}` : `prices ${ago(cases.at, now)}`;
  const title = error ? `The last read failed: ${error}. The numbers shown come from the previous read.` : `Read every 60 s while this page is open (${cases.source ?? 'book'}${cases.remaining != null ? `, ${cases.remaining} of ${cases.limit} requests left that minute` : ''}).`;
  return head(live, title) + `
    <div class="ss-c-rows">${rows}</div>
    <div class="ss-c-foot ss-muted">contents at best bid, oil at ask, no tax on either leg · sell when the bid clears the open value by ${pct(SELL_MARGIN)}%, open when it is the other way · ${avgNote} · scraps ${fmt(s.scrapBid)}</div>`;
}

/**
 * The line under "Nearest wooden case · N regions away": what the walk costs
 * either way and what is left of the case, sealed or opened. { html, title }.
 */
export function tripLineHtml({ hops, oilAsk, sealedBid, openValue }) {
  if (hops == null) return { html: '', title: '' };
  const sealed = tripCost({ hops, oilAsk, value: sealedBid });
  const opened = tripCost({ hops, oilAsk, value: openValue });
  const oil = sealed.oilGold == null ? `${sealed.oil} oil` : `${sealed.oil} oil = ${fmt(sealed.oilGold, 2)} g`;
  const parts = [`<b>${hops}</b> region${hops === 1 ? '' : 's'}: <b>${sealed.stamina}</b> stamina, or <b>${oil}</b>`];
  if (sealedBid != null) parts.push(`sold sealed ${fmt(sealedBid, 2)} → <b class="${sealed.paysOneWay ? 'ss-good' : 'ss-bad'}">${signed(sealed.netOneWay, 2)}</b> on oil`);
  if (openValue != null) parts.push(`opened ${fmt(openValue, 2)} → <b class="${opened.paysOneWay ? 'ss-good' : 'ss-bad'}">${signed(opened.netOneWay, 2)}</b>`);
  const verdict = sealed.paysOneWay == null ? '' : sealed.paysOneWay
    ? (hops * 10 <= 100 ? 'free on a full bar; pays on oil too' : 'pays on oil')
    : 'oil loses gold: go on the bar or let it lie';
  const html = `<span class="ss-trip-line">${parts.join(' · ')}</span><span class="ss-trip-verdict ${sealed.paysOneWay === false ? 'ss-bad' : 'ss-good'}">${verdict}</span>`;
  const title = [
    'Trip rule (v0.26): 10 stamina a region when the bar covers the whole trip, else 2 oil a region for the whole trip, never both.',
    `One way on oil: ${fmt(sealed.oilGold, 3)} g at oil ask ${fmt(oilAsk, 3)}. Round trip: sealed ${signed(sealed.netRoundTrip, 2)}, opened ${signed(opened.netRoundTrip, 2)}.`,
    `Oil pays one way up to ${sealed.breakevenHops == null ? '–' : Math.floor(sealed.breakevenHops)} regions sold sealed, ${opened.breakevenHops == null ? '–' : Math.floor(opened.breakevenHops)} opened.`,
  ].join(' ');
  return { html, title };
}
