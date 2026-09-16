import { snapshotSummary, tripCost } from "./cases.mjs";
import { freshness, TTL, quote } from "./quality.mjs";
import { fmt, signed, fmtQty, ago, escapeHtml as esc } from "./format.mjs";
import { header, notice as noticeHtml } from "./ui.mjs";

export function verdictTag(verdict) {
  return (
    {
      sell: {
        text: "SELL vs scrap",
        cls: "sell",
        why: "Sealed bid exceeds this opening model by at least 10%",
      },
      open: {
        text: "OPEN EV",
        cls: "open",
        why: "Expected proceeds exceed sealed bid by at least 10%; one opening can lose",
      },
      even: {
        text: "UNCERTAIN",
        cls: "even",
        why: "Within the margin or model uncertainty band",
      },
    }[verdict] ?? {
      text: "NO SIGNAL",
      cls: "none",
      why: "Insufficient fresh prices or observed depth",
    }
  );
}

export function casesStripHtml({
  cases,
  error = null,
  notice = null,
  busy = false,
  now = Date.now(),
  collapsed = false,
}) {
  const fresh = !error && freshness(cases?.at, TTL.cases, now) === "fresh";
  const head = header("Cases", {
    at: cases?.at,
    now,
    status: notice
      ? "setup"
      : fresh
        ? "fresh"
        : cases?.at
          ? "stale"
          : "loading",
    collapsed,
    busy,
  });
  if (notice) return head + noticeHtml(notice);
  if (!cases?.books)
    return (
      head + `<p class="lens-notice">${esc(error ?? "Reading case books…")}</p>`
    );
  const avg = cases.avg;
  const values = avg?.values ?? avg;
  const currentAvg = values
    ? Object.fromEntries(
        Object.entries(values).map(([c, v]) => [
          c,
          freshness(avg?.times?.[c] ?? cases.avgAt, TTL.avg, now) === "fresh" &&
          !avg?.failures?.[c]
            ? v
            : null,
        ]),
      )
    : null;
  const s = snapshotSummary({ books: cases.books, avg: currentAvg });
  const rows = s.rows
    .map((r) => {
      const tag = verdictTag(fresh ? r.verdict : null);
      const label =
        r.code === "woodenCase" && tag.cls === "sell" ? "SELL" : tag.text;
      return `<article class="lens-case" data-verdict="${esc(fresh ? (r.verdict ?? "none") : "none")}"><div><strong>${esc(r.label)}</strong><small>${esc(r.basis)}</small></div><div><small>Sealed bid</small><b>${fmt(r.bid)} g</b></div><div><small>Expected opening value</small><b>${r.complete ? fmt(r.openValue) : "–"} g</b></div><div><span class="lens-tag ${esc(tag.cls)}">${esc(label)}</span><small>${fresh ? esc(tag.why) : "Stale data; recommendation paused"}</small></div><div class="lens-case-details" ${collapsed ? "hidden" : ""}><span>Top bid depth ${fmtQty(r.bidQty)}${cases.books[r.code]?.bidCapped ? "+" : ""} · ask ${fmt(r.ask)} g</span><span>${r.code === "woodenCase" ? `Floor/round model band ${fmt(r.openBand?.[0])}–${fmt(r.openBand?.[1])} g · ${s.wooden.complete ? "20/20 resources covered" : `${s.wooden.missing.length} resources lack price/depth`}` : `Historical resale estimate ${fmt(r.openMarket)} g · priced probability coverage ${fmt((r.coverage ?? 0) * 100, 1)}% · not instant cash`}</span></div></article>`;
    })
    .join("");
  return (
    head +
    (error ? `<p class="lens-notice" role="status">${esc(error)}</p>` : "") +
    `<div class="lens-cases">${rows}</div><p class="lens-muted" ${collapsed ? "hidden" : ""}>Expected values, not guaranteed rewards. Wooden model uses floor/round bounds; battle signals compare sealed bids with scrap-only EV. Historical resale is a separate partial estimate, never substituted for missing items. Depth is a snapshot, not reserved. No additional tax adjustment. Rules pinned 2026-09-16.</p>${cases.avgError ? `<p class="lens-notice">Resale estimates: ${esc(cases.avgError)}</p>` : ""}`
  );
}

export function tripLineHtml({
  hops,
  oilAsk,
  sealedBid,
  openValue,
  oilAsks = null,
  roundTrip = false,
  fresh = true,
  at = null,
}) {
  if (hops == null) return { html: "", title: "" };
  const count = roundTrip ? 2 : 1;
  const sealed = tripCost({ hops, oilAsk, value: sealedBid });
  const oilQty = sealed.oil * count;
  const cost = oilAsks
    ? quote(oilQty, oilAsks).value
    : sealed.oilGold == null
      ? null
      : sealed.oilGold * count;
  const netSealed = cost == null || sealedBid == null ? null : sealedBid - cost;
  const netOpen = cost == null || openValue == null ? null : openValue - cost;
  const safe = fresh && cost != null;
  const html = `<div class="lens-trip"><strong>${hops} region${hops === 1 ? "" : "s"}</strong><button type="button" data-action="trip-mode" aria-pressed="${roundTrip}">${roundTrip ? "Round trip" : "One way"}</button><span>${sealed.stamina * count} stamina required, or ${oilQty} oil · ${fmt(cost)} g</span><span>Sealed net <b>${signed(netSealed)} g</b> · opened expected net <b>${signed(netOpen)} g</b></span><span class="lens-status" data-status="${safe ? "fresh" : "stale"}">${!fresh ? "Stale prices; no recommendation" : cost == null ? "Insufficient oil ask depth" : netSealed == null ? "Sealed price unavailable" : netSealed > 0 ? "Positive oil-funded snapshot" : "Oil does not cover the sealed return"}</span><small>Stamina option requires enough stamina for each leg; balance not read. Prices ${esc(ago(at))}.</small></div>`;
  return {
    html,
    title: `Travel model: 10 stamina or 2 oil per region per leg. ${roundTrip ? "Round trip" : "One way"} depth-adjusted sealed net ${signed(netSealed)}. Expected opened net ${signed(netOpen)} is not guaranteed.`,
  };
}
