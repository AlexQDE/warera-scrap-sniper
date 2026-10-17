// @vitest-environment jsdom
// The v0.27 auction house, read off the dev server's own markup (fixtures/v027-auctions.json, read
// 2026-10-17): every text node as the page had it, so "277", ".", "927" and "5h", "35m", "28s" stay apart.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import {
  auctionRows,
  auctionTokens,
  readAuctionTokens,
  createRowCache,
  offerRows,
  offerButtonCount,
} from "./dom.mjs";
import { readStatBlock } from "./offers.mjs";
import { createEquipment } from "./equipment.mjs";
import { DEFAULTS } from "./settings.mjs";

// jsdom replaces the global URL, which node:fs does not take: resolve the path as a string
const FIXTURE = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../fixtures/v027-auctions.json",
    ),
    "utf8",
  ),
);
/** An element tree of the fixture as live nodes; styles as inline styles. */
function build(t) {
  if (typeof t === "string") return document.createTextNode(t);
  const [tag, attrs, ...kids] = t;
  const el =
    tag === "svg"
      ? document.createElementNS("http://www.w3.org/2000/svg", "svg")
      : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k !== "_s") {
      el.setAttribute(k, v);
      continue;
    }
    const style = [
      v.bi ? "background-image: linear-gradient(45deg, red, black)" : "",
      v.bc ? `background-color: ${v.bc}` : "",
      v.bd ? `border: 1px solid ${v.bd}` : "",
      v.tf ? `transform: ${v.tf}` : "",
    ].filter(Boolean);
    el.setAttribute("style", style.join("; "));
  }
  for (const kid of kids) el.appendChild(build(kid));
  return el;
}
export function auctionPage(cards = FIXTURE.cards) {
  document.body.innerHTML =
    '<main><section id="market"></section><div id="list"></div></main>';
  document.getElementById("market").appendChild(build(FIXTURE.notice));
  for (const c of cards) document.getElementById("list").appendChild(build(c));
}

/** A labelled pager as React prints "Page {n}": the label and the number in text nodes of their own. */
const PAGER =
  "<button>Page <span>1</span></button><button>Page <span>2</span></button>";

beforeEach(() => auctionPage());
afterEach(() => {
  document.body.innerHTML = "";
});

describe("the v0.27 auction cards", () => {
  it("reads a card without bids: the stats, the countdown, the start and max before tax, the buttons with it", () => {
    const [tank] = auctionRows();
    expect(tank).toMatchObject({
      kind: "auction",
      alt: "tank",
      price: 305.72,
      priceText: "305.72",
      bid: 218.9,
      start: 199,
      max: 277.927,
      ends: "5h35m28s",
    });
    expect(readStatBlock(tank.tokens)).toMatchObject({
      readable: true,
      stats: [151, 33],
      durability: 100,
    });
  });
  it("reads a skinned card and a card that has bids (its current bid takes the start's place)", () => {
    const [, mythic, elite] = auctionRows();
    expect(mythic).toMatchObject({
      alt: "vampireCountessGloves",
      start: 600,
      max: 639.35,
      price: 703.28,
      bid: 660,
      ends: "6d23h26m6s",
    });
    expect(readStatBlock(mythic.tokens).stats).toEqual([60]);
    expect(elite).toMatchObject({
      start: 25.9,
      max: 141.122,
      price: 155.23,
      bid: 29.91,
      ends: "22h23m52s",
    });
    expect(auctionRows()).toHaveLength(3);
  });
  it("skips a card without the buy-now and bid pair (an own auction, an ended one)", () => {
    const cards = document.querySelectorAll("#list > div");
    // no bid button left: one priced button
    [...cards[0].querySelectorAll("button")].at(-1).remove();
    // an own auction: a cancel button instead of the pair
    for (const b of cards[1].querySelectorAll("button")) b.remove();
    cards[1].insertAdjacentHTML("beforeend", "<button>Cancel auction</button>");
    const rows = auctionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].start).toBe(25.9);
  });
  it("reads the prices around any countdown, and without one", () => {
    const span = (card) =>
      [...card.querySelectorAll("span")].find((s) =>
        /^\d+[dhms]/.test(s.textContent ?? ""),
      );
    const cards = document.querySelectorAll("#list > div");
    span(cards[0]).textContent = "45s";
    span(cards[1]).remove();
    const [a, b] = auctionRows();
    expect(a).toMatchObject({ ends: "45s", start: 199, max: 277.927 });
    expect(b).toMatchObject({ ends: null, start: 600, max: 639.35 });
  });
  it("looks for the countdown before the prices: a seller called like one after them is not it", () => {
    expect(
      readAuctionTokens([
        "151",
        "33%",
        "100%",
        "Tank",
        "5ч35м",
        "Starting price",
        "199",
        "Max price",
        "277.927",
        "24h",
        "0 bids",
      ]),
    ).toEqual({ name: "Tank", ends: null, start: 199, max: 277.927 });
  });
  it("takes no list for a card: a number without a label is no price, and a card shows one piece", () => {
    // v0.26 offer rows (BUY carries no amount) and a pager under them
    const offer = (alt) =>
      `<article><div><img alt="${alt}"></div><div>1</div><button>BUY</button></article>`;
    document.body.innerHTML = `<main><div id="offers">${["knife", "rifle", "tank"].map(offer).join("")}</div><nav><button>1</button><button>2</button></nav></main>`;
    expect(auctionRows()).toHaveLength(0);
    // a labelled pager, its number in a text node of its own as React prints "Page {n}"
    document.querySelector("nav").innerHTML = PAGER;
    expect(auctionRows()).toHaveLength(0);
    expect(offerRows()).toHaveLength(3);
  });
  it("takes no lone piece above a pager for a card: a card's buy now is its max price and a tax", () => {
    // one v0.26 offer and a labelled pager: one piece and two labelled amounts, but no max price
    document.body.innerHTML = `<main><div id="offers"><article><div><img alt="knife"></div><div>1</div><button>BUY</button></article></div><nav>${PAGER}</nav></main>`;
    expect(auctionRows()).toHaveLength(0);
    // one own auction (no buy-now or bid) above the pager: its max price, 277.927, is no tax away from "Page 1"
    auctionPage(FIXTURE.cards.slice(0, 1));
    for (const b of document.querySelectorAll("#list button")) b.remove();
    document
      .querySelector("main")
      .insertAdjacentHTML("beforeend", `<nav>${PAGER}</nav>`);
    expect(auctionRows()).toHaveLength(0);
  });
  it("reads a card's text again as its countdown ticks, and its frame once", () => {
    const cache = createRowCache();
    auctionRows(document, undefined, cache);
    expect(cache).toMatchObject({ reads: 3, styleReads: 3 });
    const walk = document.createTreeWalker(document.body, 4);
    while (walk.nextNode())
      if (walk.currentNode.nodeValue === "28s")
        walk.currentNode.nodeValue = "27s";
    const [tank] = auctionRows(document, undefined, cache);
    expect(tank.ends).toBe("5h35m27s");
    expect(cache).toMatchObject({ reads: 4, styleReads: 3 });
  });
  it("joins what the page splits: a decimal's parts, a percent, a countdown's units", () => {
    const tank = document.querySelector("#list > div");
    expect(auctionTokens(tank)).toEqual([
      "151",
      "33%",
      "100%",
      "Tank",
      "5h35m28s",
      "Starting price",
      "199",
      "Max price",
      "277.927",
      "seller_1",
      "0 bids",
    ]);
  });
  it("leaves the old offer rows to their reader, and counts the auction buttons as offer buttons", () => {
    expect(offerRows()).toHaveLength(0);
    expect(offerButtonCount()).toBe(6);
    document.body.innerHTML =
      '<main><article><div><img alt="knife"></div><div>1</div><button>BUY</button></article></main>';
    expect(auctionRows()).toHaveLength(0);
    expect(offerRows()).toHaveLength(1);
  });
});

describe("verdicts on the auction cards", () => {
  let equipment;
  const settings = { ...DEFAULTS };
  const state = (bid) => ({
    book: {
      at: new Date().toISOString(),
      bids: [{ price: bid, quantity: 5000 }],
    },
    error: null,
    setup: null,
  });
  const card = (i) => document.querySelectorAll("#list > div")[i];
  const line = (i) =>
    card(i).querySelector(".ss-verdict")?.textContent.replace(/\s+/g, " ") ??
    "";
  // the countdown a card prints, set (the elite gloves, card 2, print 22h23m52s)
  const endsIn = (i, text) => {
    [...card(i).querySelectorAll("span")].find((s) =>
      /^\d+[dhms]/.test(s.textContent ?? ""),
    ).textContent = text;
  };
  beforeEach(() => {
    window.history.replaceState({}, "", "/market/auctions");
    equipment = createEquipment({
      settings: () => settings,
      requestSales: () => {},
    });
  });
  afterEach(() => equipment.clear());
  it("tags BID with the most to bid before tax when the next bid pays and buying now does not", () => {
    // epic gloves (162 scraps) at a 0.2 bid: 32.4; next bid 29.91 with the 10% tax; buy now 155.23
    endsIn(2, "4m10s");
    equipment.render(state(0.2));
    expect(card(2).dataset.scrapSniper).toBe("bid");
    // the most to bid: 32.4 / 1.03 (the 3% SNIPE minimum) / 1.10 (the tax) = 28.59
    expect(line(2)).toContain("BID");
    expect(line(2)).toContain("≤ 28.59");
    expect(card(0).dataset.scrapSniper).toBe("miss"); // tank: 97.2 of scraps against 218.9 and 305.72
    expect(equipment.pulse()).toContain("1</b> bid");
  });
  it("tags BID only in an auction's last ten minutes: before them a bid wins nothing yet", () => {
    // the same gloves with 22 hours to go: the next bid would pay, but the price is far from final
    equipment.render(state(0.2));
    expect(card(2).dataset.scrapSniper).not.toBe("bid");
    expect(line(2)).not.toContain("BID");
    expect(equipment.pulse()).not.toContain("bid");
    card(2).querySelector("[data-action='details']").click();
    equipment.render(state(0.2));
    const details = card(2)
      .querySelector(".lens-details")
      .textContent.replace(/\s+/g, " ");
    // the most to bid stays in the details, with when BID shows
    expect(details).toContain("bid at most 28.59");
    expect(details).toContain("last 10 minutes");
    for (const [ends, tagged] of [
      ["10m0s", true],
      ["9m59s", true],
      ["10m1s", false],
      ["1h", false],
      ["5ч", false], // a countdown it cannot read: no BID
    ]) {
      endsIn(2, ends);
      equipment.render(state(0.2));
      expect(card(2).dataset.scrapSniper === "bid").toBe(tagged);
    }
  });
  it("tags SNIPE when buying now pays", () => {
    // 162 scraps at 1: 162 against buy now 155.23
    equipment.render(state(1));
    expect(card(2).dataset.scrapSniper).toBe("hit");
    expect(line(2)).toContain("SNIPE");
  });
  it("reads the tax off the card when the notice gives none, and tags nothing when the card and the notice disagree", () => {
    document.getElementById("market").innerHTML =
      "<div><span>Live auctions</span></div>";
    endsIn(2, "4m10s");
    equipment.render(state(0.2));
    expect(card(2).dataset.scrapSniper).toBe("bid");
    equipment.clear();
    document.getElementById("market").innerHTML =
      "<div><span>Live auctions</span><span>Bids are shown before tax: your country adds its 20% market tax.</span></div>";
    equipment.render(state(0.2));
    expect(card(2).dataset.scrapSniper).toBe("unknown");
    expect(line(2)).toContain("tax check failed");
  });
  it("shows no gain on a card that fails the tax check, whatever pieces of its stats sold for", () => {
    document.getElementById("market").innerHTML =
      "<div><span>Live auctions</span><span>Bids are shown before tax: your country adds its 20% market tax.</span></div>";
    // epic gloves at precision 23 sold three times at 200 today; the card's buy now reads 155.23
    const at = (h) => new Date(Date.now() - h * 3600e3).toISOString();
    const fill = (h) => ({
      price: 200,
      at: at(h),
      state: 100,
      code: "gloves4",
      skills: { precision: 23 },
      listedAt: at(h + 2),
    });
    equipment.render({
      ...state(0.2),
      salesByCode: {
        gloves4: {
          code: "gloves4",
          at: at(0),
          complete: true,
          fills: [fill(1), fill(2), fill(3)],
        },
      },
    });
    expect(card(2).dataset.scrapSniper).toBe("unknown");
    expect(line(2)).toContain("sells 200");
    expect(card(2).querySelector(".lens-gain").textContent).toBe("–");
  });
  it("counts no card that failed the tax check among the listed peers, and gives its bid no pre-tax figure", () => {
    // a fourth card, the epic gloves again, its buy now 170.00 where the page's 10% makes 155.23 of its max
    auctionPage([...FIXTURE.cards, FIXTURE.cards[2]]);
    const [whole, , decimals] = [...card(3).querySelectorAll("button")]
      .flatMap((b) => {
        const out = [];
        const walk = document.createTreeWalker(b, 4);
        while (walk.nextNode()) out.push(walk.currentNode);
        return out;
      })
      .filter((n) => /^(155|\.|23)$/.test(n.nodeValue));
    whole.nodeValue = "170";
    decimals.nodeValue = "00";
    const details = (i) => {
      card(i).querySelector("[data-action='details']").click();
      equipment.render(state(0.2));
      return card(i)
        .querySelector(".lens-details")
        .textContent.replace(/\s+/g, " ");
    };
    equipment.render(state(0.2));
    expect(card(3).dataset.scrapSniper).toBe("unknown");
    expect(card(2).dataset.scrapSniper).not.toBe("unknown"); // it passed the tax check
    expect(details(2)).not.toContain("Listed now with these stats");
    const failed = details(3);
    expect(failed).toContain("next bid 29.910 g · start");
    expect(failed).not.toContain("before tax) · start");
  });
  it("values a skinned card by its stats: the tier its stat falls in", () => {
    equipment.render(state(0.2));
    // vampireCountessGloves at precision 60: mythic gloves, 1458 scraps (291.6, printed 292)
    expect(line(1)).toContain("scrap 292");
    // at 23: epic gloves, 162 scraps
    expect(line(2)).toContain("scrap 32.4");
  });
});

describe("readStatBlock", () => {
  it("reads the leading numbers: the last percentage is the durability, the numbers before it the stats", () => {
    expect(readStatBlock(["151", "33%", "100%", "Tank"])).toMatchObject({
      readable: true,
      stats: [151, 33],
      stat: 151,
      durability: 100,
    });
    expect(readStatBlock(["23%", "100%", "Elite Gloves"])).toMatchObject({
      readable: true,
      stats: [23],
      durability: 100,
    });
    expect(readStatBlock(["Tank", "199"])).toMatchObject({
      readable: false,
      stats: [],
      durability: null,
    });
  });
});
