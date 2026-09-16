import { describe, it, expect } from "vitest";
import { casesStripHtml, tripLineHtml, verdictTag, ago } from "./casesui.mjs";
import { WOODEN_CODES, ALL_GEAR_CODES } from "./cases.mjs";

const NOW = Date.parse("2026-09-16T10:00:00Z");
const at = new Date(NOW - 12000).toISOString();
const book = (price, quantity = 20000) => ({
  bid: price,
  ask: price,
  bidQty: quantity,
  askQty: quantity,
  bids: [{ price, quantity }],
  asks: [{ price, quantity }],
});
const books = Object.fromEntries(
  [...WOODEN_CODES, "woodenCase", "case1", "case2", "scraps"].map((c) => [
    c,
    book(
      c === "woodenCase"
        ? 100
        : c === "scraps"
          ? 0.222
          : c === "case1"
            ? 3.439
            : c === "case2"
              ? 21.701
              : 1,
    ),
  ]),
);
const cases = { at, books };

describe("safe case rendering", () => {
  it("renders three cases with explicit depth, model and freshness", () => {
    const html = casesStripHtml({ cases, now: NOW });
    expect(html).toContain("Wooden Case");
    expect(html).toContain("Elite Case");
    expect(html).toContain('data-status="fresh"');
    expect(html).toContain("12s ago");
    expect(html).toContain("Top bid depth 20k");
    expect(html).toContain("Floor/round model band");
    expect(html).toContain('data-verdict="sell"');
    expect(html).toContain('data-verdict="even"');
  });
  it("keeps historical resale separate from the actionable scrap model", () => {
    const avg = {
      values: Object.fromEntries(ALL_GEAR_CODES.map((c) => [c, 100])),
      times: Object.fromEntries(ALL_GEAR_CODES.map((c) => [c, at])),
    };
    const html = casesStripHtml({ cases: { ...cases, avg }, now: NOW });
    expect(html).toContain("sold at avg (all drops) 100.000 g");
    expect(html).toContain("selling takes time");
    expect(html).not.toContain('data-verdict="open"');
    avg.failures = { jet: "failed" };
    const partial = casesStripHtml({ cases: { ...cases, avg }, now: NOW });
    expect(partial).not.toBe(html);
  });
  it("never recommends on stale books or an incomplete drop outcome", () => {
    const stale = casesStripHtml({ cases, now: NOW + 60000 });
    expect(stale).toContain("Stale data; recommendation paused");
    expect(stale).not.toContain('data-verdict="sell"');
    const incomplete = casesStripHtml({
      cases: { ...cases, books: { ...books, scraps: book(0.222, 100) } },
      now: NOW,
    });
    expect(incomplete).toContain("NO SIGNAL");
    expect(incomplete).not.toContain("SELL vs scrap");
  });
  it("escapes untrusted setup and API error messages, preserving old values without signals", () => {
    const attack = "<img src=x onerror=alert(1)>";
    for (const html of [
      casesStripHtml({ cases: null, notice: attack }),
      casesStripHtml({ cases, error: attack, now: NOW }),
      casesStripHtml({ cases: { ...cases, avgError: attack }, now: NOW }),
    ]) {
      expect(html).not.toContain("<img");
      expect(html).toContain("&lt;img");
    }
    const failure = casesStripHtml({ cases, error: "API 503", now: NOW });
    expect(failure).toContain("100.000");
    expect(failure).not.toContain('data-verdict="sell"');
    expect(casesStripHtml({ cases: null })).toContain("Reading case books");
  });
  it("keeps collapsed details in a hidden semantic region", () => {
    const html = casesStripHtml({ cases, now: NOW, collapsed: true });
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('class="lens-case-details" hidden');
  });
});

describe("travel rendering", () => {
  const input = { hops: 7, oilAsk: 0.242, sealedBid: 7.55, openValue: 6.12 };
  it("shows oil costs and stamina requirements without assuming a full bar", () => {
    const { html } = tripLineHtml(input);
    expect(html).toContain("70 stamina required, or 14 oil · 3.388 g");
    expect(html).toContain("+4.162 g");
    expect(html).toContain("+2.732 g");
    expect(html).toContain("balance not read");
    expect(html).not.toContain("free");
  });
  it("walks asks separately for the complete return quantity", () => {
    const { html } = tripLineHtml({
      ...input,
      roundTrip: true,
      oilAsks: [
        { price: 0.242, quantity: 14 },
        { price: 0.3, quantity: 14 },
      ],
    });
    expect(html).toContain("140 stamina required, or 28 oil · 7.588 g");
    expect(html).toContain("−0.038 g");
    expect(html).toContain('aria-pressed="true"');
  });
  it("suppresses recommendations on stale or insufficient oil data", () => {
    expect(tripLineHtml({ ...input, fresh: false }).html).toContain(
      "Stale prices; no recommendation",
    );
    const html = tripLineHtml({ ...input, oilAsks: [] }).html;
    expect(html).toContain("Insufficient oil ask depth");
    expect(html).not.toContain("Positive oil-funded");
    expect(tripLineHtml({ ...input, hops: null }).html).toBe("");
  });
  it("names uncertainty and formats ages", () => {
    expect(verdictTag("open").text).toBe("OPEN EV");
    expect(verdictTag("even").text).toBe("UNCERTAIN");
    expect(verdictTag(null).text).toBe("NO SIGNAL");
    expect(ago(at, NOW)).toBe("12s ago");
    expect(ago(null)).toBe("never");
  });
});
