// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  findSellForm,
  readSellForm,
  renderSellHint,
  sellHintHtml,
  findAuctionForm,
  readAuctionForm,
  auctionHintHtml,
  renderAuctionHint,
} from "./sellform.mjs";

// v0.27's Start an auction form as read on dev 2026-10-17 (fixtures/v027-auctions.json), one epic sniper picked
const FIXTURE = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../fixtures/v027-auctions.json",
    ),
    "utf8",
  ),
);
function build(t) {
  if (typeof t === "string") return document.createTextNode(t);
  const [tag, attrs, ...kids] = t;
  const el =
    tag === "svg"
      ? document.createElementNS("http://www.w3.org/2000/svg", "svg")
      : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k !== "_s") el.setAttribute(k, v);
    else if (v.bi)
      el.setAttribute(
        "style",
        "background-image: linear-gradient(45deg, red, black)",
      );
  }
  for (const kid of kids) el.appendChild(build(kid));
  return el;
}

// The sell form as read live on 2026-10-10 with one mythic jet picked: the
// picked tile, the item's name and rarity, the game's "Market average", the
// PRICE input prefilled with the game's "Suggested price", and the range it
// allows (353 to 806.5, 0.7-1.6x of the suggestion).
const jet = `<div class="tile" style="background-image: linear-gradient(45deg, red, black)"><img alt="winterJet" src="x.png"><div>270</div><div>50<b>%</b></div><div>100<b>%</b></div></div>`;
const FORM = (tiles = jet) =>
  `<main></main><div role="dialog"><div class="backdrop"></div><div class="wrapper"><div class="card"><div>Sell an item</div><div class="slots">${tiles}<div>+</div></div><div>Items</div><div>Fighter Jet</div><div>Mythic</div><div>Market average <span>484.55</span></div><div class="block"><label><span>PRICE</span><div><div><input name="price" value="504.177"></div><button>-</button><button>+</button></div></label><div>Suggested price <span>504.177</span></div><div class="range"><span>353</span><span>504.177</span><span>806.5</span></div></div><div>You receive <span>504.177</span></div><button>Close</button><button>Put on sale</button></div></div></div>`;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the sell form", () => {
  it("finds the form and reads the picked pieces, the game's estimate and the range it allows", () => {
    document.body.innerHTML = FORM();
    const form = findSellForm();
    expect(form).not.toBeNull();
    const read = readSellForm(form);
    expect(read.input.name).toBe("price");
    expect(read.items).toEqual([
      {
        code: "jet",
        stats: [270, 50],
        skills: { attack: 270, criticalChance: 50 },
      },
    ]);
    expect(read.game).toEqual({
      average: 484.55,
      suggested: 504.177,
      min: 353,
      max: 806.5,
    });
    document.body.innerHTML = "<main></main>";
    expect(findSellForm()).toBeNull();
  });
  it("puts one line under PRICE, and Use writes the price into the game's input without listing anything", () => {
    document.body.innerHTML = FORM();
    const form = findSellForm();
    const read = readSellForm(form);
    const html = sellHintHtml([
      {
        code: "jet",
        s: {
          price: 471.9,
          why: "first in line",
          sold: {
            value: 485,
            n: 12,
            level: "same",
            hours: 24,
            label: "12 same · 24 h",
          },
          floor: { price: 471.901, ageMin: 10 },
          trend: 0.04,
          rising: true,
          clamped: false,
        },
      },
    ]);
    const typed = vi.fn();
    read.input.addEventListener("input", (e) => typed(e.target.value));
    const sale = vi.fn();
    [...form.querySelectorAll("button")]
      .find((b) => b.textContent === "Put on sale")
      .addEventListener("click", sale);
    renderSellHint(read, html);
    renderSellHint(read, html); // a second scan keeps one line
    const hints = form.querySelectorAll(".ss-sell");
    expect(hints).toHaveLength(1);
    expect(hints[0].previousElementSibling.tagName).toBe("LABEL");
    const text = hints[0].textContent.replace(/\s+/g, " ");
    expect(text).toContain("471.9 first in line");
    expect(text).toContain("sold 485 · 12 same · 24 h");
    expect(text).toContain("ask 472 · 10 min");
    expect(text).toContain("rising");
    hints[0].querySelector("[data-sell-use]").click();
    expect(read.input.value).toBe("471.9");
    expect(typed).toHaveBeenCalledWith("471.9");
    expect(sale).not.toHaveBeenCalled();
  });
  it("says when the ask it lists under is a piece of better stats", () => {
    const div = document.createElement("div");
    div.innerHTML = sellHintHtml([
      {
        code: "jet",
        s: {
          price: 534.998,
          why: "under better stats",
          sold: {
            value: 494,
            n: 5,
            level: "same",
            hours: 24,
            label: "5 same · 24 h",
          },
          floor: { price: 534.999, ageMin: 46, better: true },
          trend: null,
          rising: false,
          clamped: false,
        },
      },
    ]);
    const text = div.textContent.replace(/\s+/g, " ");
    expect(text).toContain("534.998 under better stats");
    expect(text).toContain("better ask 535 · 46 min");
  });
  it("says the sales need the API key when there is none to read them with", () => {
    const div = document.createElement("div");
    div.innerHTML = sellHintHtml([
      {
        code: "boots5",
        noKey: true,
        s: {
          price: 190,
          why: "the game's estimate",
          sold: { value: null, n: 0, level: null, hours: null, label: "" },
          floor: null,
          trend: null,
          rising: false,
          clamped: false,
        },
      },
    ]);
    const text = div.textContent.replace(/\s+/g, " ");
    expect(text).toContain("190 the game's estimate");
    expect(text).toContain("sales need your API key");
  });
  it("says to list apart when the picked pieces are worth very different prices", () => {
    const one = (code, price) => ({
      code,
      s: {
        price,
        why: "what sells",
        sold: {
          value: price,
          n: 3,
          level: "same",
          hours: 24,
          label: "3 same · 24 h",
        },
        floor: null,
        trend: null,
        rising: false,
        clamped: false,
      },
    });
    const html = sellHintHtml([one("jet", 471.9), one("tank", 180)]);
    const div = document.createElement("div");
    div.innerHTML = html;
    const text = div.textContent.replace(/\s+/g, " ");
    // one price would sell the jet at the tank's: no Use, a warning with each piece's price
    expect(text).toContain("list apart: jet 472 · tank 180");
    expect(div.querySelector("[data-sell-use]")).toBeNull();
    // a piece whose sales are still being read: wait for them rather than show the game's estimate first
    div.innerHTML = sellHintHtml([{ code: "jet", s: null }]);
    expect(div.textContent).toContain("reading the sales");
    expect(div.querySelector("[data-sell-use]")).toBeNull();
    // close enough: one price for all, the lowest, so none sits above what it sells for
    const near = sellHintHtml([one("tank", 180), one("tank", 175)]);
    div.innerHTML = near;
    expect(div.textContent.replace(/\s+/g, " ")).toContain("175 for all");
    expect(div.querySelector("[data-sell-use]").dataset.sellUse).toBe("175");
  });
});

describe("the Start an auction form (v0.27)", () => {
  const open = () => {
    document.body.innerHTML = "<main></main>";
    document.body.appendChild(build(FIXTURE.form));
    return findAuctionForm();
  };
  const s = {
    start: 32.4,
    max: 90,
    est: 82.404,
    lo: 82.404,
    hi: 131.846,
    why: "what these stats sell for",
    clamped: false,
    sold: { value: 90, n: 3, level: "same", hours: 24, label: "3 same · 24 h" },
  };
  it("reads the picked piece and the range the game prints for its max price", () => {
    const form = open();
    expect(form).not.toBeNull();
    expect(findSellForm()).toBeNull(); // not the v0.26 sell form
    const read = readAuctionForm(form);
    expect(read.start.name).toBe("startPrice");
    expect(read.max.name).toBe("maxPrice");
    expect(read.items).toEqual([
      {
        code: "sniper",
        stats: [123, 16],
        skills: { attack: 123, criticalChance: 16 },
      },
    ]);
    expect(read.range).toEqual({ lo: 82.404, hi: 131.846 });
  });
  it("reads the range off its sentence: a decimal printed in pieces is one number, a slider's numbers are none", () => {
    // the form's text nodes in page order: the start slider ("0", "0", "131", ".", "846"), then the sentence
    // "From 82.404 to 131.846", then the max price again
    const nodes = (form) => {
      const out = [];
      const walk = document.createTreeWalker(form, 4);
      while (walk.nextNode()) out.push(walk.currentNode);
      return out;
    };
    // a 9.525 estimate: the slider ends at 15.24, printed "15" "." "24" (24 is 1.6 times 15), and the
    // sentence's 15.24 printed "15" ".24"
    let form = open();
    nodes(form).find((n) => n.nodeValue === "131").nodeValue = "15";
    nodes(form).find((n) => n.nodeValue === "846").nodeValue = "24";
    for (const n of nodes(form)) {
      if (n.nodeValue === "82.404") n.nodeValue = "9.525";
      else if (n.nodeValue === "131.846") {
        const decimals = document.createElement("span");
        decimals.textContent = ".24";
        n.replaceWith("15", decimals);
      }
    }
    expect(readAuctionForm(form).range).toEqual({ lo: 9.525, hi: 15.24 });
    // the start slider at 50 of a max of 80: two numbers side by side, 1.6 apart, before the sentence
    form = open();
    const [, current, whole, dot, decimals] = nodes(form).filter((n) =>
      /^(0|131|\.|846)$/.test(n.nodeValue),
    );
    current.nodeValue = "50";
    whole.nodeValue = "80";
    dot.nodeValue = "";
    decimals.nodeValue = "";
    expect(readAuctionForm(form).range).toEqual({ lo: 82.404, hi: 131.846 });
  });
  it("puts one line under the max price, and Use writes both prices without starting the auction", () => {
    const form = open();
    const read = readAuctionForm(form);
    const typed = vi.fn();
    read.start.addEventListener("input", (e) => typed("start", e.target.value));
    read.max.addEventListener("input", (e) => typed("max", e.target.value));
    const started = vi.fn();
    form.querySelector("form").addEventListener("submit", started);
    form
      .querySelector('button[type="submit"]')
      .addEventListener("click", started);
    renderAuctionHint(read, auctionHintHtml({ count: 1, s }));
    renderAuctionHint(read, auctionHintHtml({ count: 1, s })); // a second scan keeps one line
    const hints = form.querySelectorAll(".ss-auction");
    expect(hints).toHaveLength(1);
    expect(hints[0].previousElementSibling.tagName).toBe("LABEL");
    const text = hints[0].textContent.replace(/\s+/g, " ");
    expect(text).toContain("start 32.4");
    expect(text).toContain("max 90");
    expect(text).toContain("sold 90.0 · 3 same · 24 h");
    hints[0].querySelector("[data-auction-use]").click();
    expect(read.start.value).toBe("32.4");
    expect(read.max.value).toBe("90");
    expect(typed).toHaveBeenCalledWith("start", "32.4");
    expect(typed).toHaveBeenCalledWith("max", "90");
    expect(started).not.toHaveBeenCalled();
  });
  it("asks for one piece when several are picked, and waits for the sales", () => {
    const div = document.createElement("div");
    div.innerHTML = auctionHintHtml({ count: 2, s: null });
    expect(div.textContent).toContain("pick one piece");
    expect(div.querySelector("[data-auction-use]")).toBeNull();
    div.innerHTML = auctionHintHtml({ count: 1, s: null });
    expect(div.textContent).toContain("reading the sales");
  });
});
