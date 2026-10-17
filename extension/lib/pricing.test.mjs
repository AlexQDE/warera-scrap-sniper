import { describe, it, expect } from "vitest";
import {
  suggestPrice,
  ageMinutes,
  estimatedValue,
  suggestAuction,
} from "./pricing.mjs";

const NOW = Date.parse("2026-10-10T20:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3600e3).toISOString();
const boots = (price, dodge, h) => ({
  price,
  at: hoursAgo(h),
  skills: { dodge },
});
const ask = (price, dodge, ageMin) => ({ price, skills: { dodge }, ageMin });

// v0.27 (dev 2026-10-17): an auction's estimated value, read on 72 of 72 live auctions, and the form's own
// "From 82.404 to 131.846" for an epic sniper at 123 attack / 16% crit on an 80.87 average.
describe("the auction estimate, and a start and max price", () => {
  it("matches the game's estimate: the average times 1 + 5% of where the stats sit in their ranges", () => {
    expect(estimatedValue("chest3", { armor: 13 }, 17.64)).toBe(18.081);
    expect(
      estimatedValue("rifle", { attack: 89, criticalChance: 13 }, 15.63),
    ).toBe(16.196);
    expect(
      estimatedValue("jet", { attack: 246, criticalChance: 41 }, 448.98),
    ).toBe(452.532);
    expect(
      estimatedValue("sniper", { attack: 123, criticalChance: 16 }, 80.87),
    ).toBe(82.404);
    expect(
      estimatedValue("jet", { attack: 246, criticalChance: 41 }, 0),
    ).toBeNull();
    expect(estimatedValue("sickle3", { production: 15 }, 10)).toBeNull();
  });
  const skills = { attack: 123, criticalChance: 16 };
  const sold = (prices) =>
    prices.map((price, i) => ({ price, at: hoursAgo(i + 1), skills }));
  const auction = (over) =>
    suggestAuction({
      code: "sniper",
      skills,
      fills: [],
      avg: 80.87,
      scrap: 32.4,
      now: NOW,
      ...over,
    });
  it("asks the max what pieces of these stats sell for, inside 100-160% of the estimate, and starts at the scrap value", () => {
    expect(auction({ fills: sold([90, 91, 89]) })).toMatchObject({
      start: 32.4,
      max: 90,
      est: 82.404,
      lo: 82.404,
      hi: 131.846,
      clamped: false,
      why: "what these stats sell for",
    });
    expect(auction({ fills: sold([200, 201, 199]) })).toMatchObject({
      max: 131.846,
      clamped: true,
    });
    expect(auction({ fills: sold([50, 51, 49]) })).toMatchObject({
      max: 82.404,
      clamped: true,
    });
    expect(auction({ scrap: null })).toMatchObject({
      start: 0,
      max: 82.404,
      why: "the game's estimate",
    });
    // the range the form prints is the game's own and wins over the computed one
    expect(auction({ range: { lo: 82.5, hi: 132 } })).toMatchObject({
      lo: 82.5,
      hi: 132,
      max: 82.5,
    });
    // a start never above the max
    expect(auction({ scrap: 500 }).start).toBe(82.404);
  });
  it("takes the form's 100% as the estimate while the average is missing", () => {
    expect(
      auction({ avg: null, range: { lo: 82.404, hi: 131.846 } }),
    ).toMatchObject({
      est: 82.404,
      max: 82.404,
      start: 32.4,
      clamped: false,
      why: "the game's estimate",
    });
    // without the form's range there is nothing to go by
    expect(auction({ avg: null })).toMatchObject({ est: null, max: null });
  });
});

describe("reading a listing's age", () => {
  it("reads the row's age token in minutes", () => {
    expect(ageMinutes("7m")).toBe(7);
    expect(ageMinutes("3h47m")).toBe(227);
    expect(ageMinutes("12h ago")).toBe(720);
    expect(ageMinutes("2d")).toBe(2880);
    expect(ageMinutes("1d3h")).toBe(1620);
    expect(ageMinutes("100%")).toBeNull();
    expect(ageMinutes("32")).toBeNull();
    expect(ageMinutes("m")).toBeNull();
  });
});

describe("suggesting a price", () => {
  it("lists first in line when fresh asks of the same stats sit above what sold: prices are rising", () => {
    // what sold today at dodge 32 is lower than what is listed now, and the cheapest ask is ten minutes old
    const fills = [185, 184, 186, 183, 187].map((p, i) => boots(p, 32, i + 1));
    const s = suggestPrice({
      code: "boots5",
      skills: { dodge: 32 },
      fills,
      asks: [ask(192, 32, 10), ask(198, 32, 5), ask(205, 32, 20)],
      now: NOW,
    });
    expect(s.price).toBe(191.999);
    expect(s.why).toBe("first in line");
    expect(s.rising).toBe(true);
    expect(s.sold).toMatchObject({
      value: 185,
      n: 5,
      level: "same",
      hours: 24,
    });
    expect(s.floor).toEqual({ price: 192, ageMin: 10, better: false });
  });
  it("keeps to what sells when the cheapest ask is well under it, and offers the quick price beside", () => {
    const fills = [200, 201, 199].map((p, i) => boots(p, 32, i + 1));
    const s = suggestPrice({
      code: "boots5",
      skills: { dodge: 32 },
      fills,
      asks: [ask(170, 32, 180)],
      now: NOW,
    });
    expect(s.price).toBe(200);
    expect(s.why).toBe("what sells; the cheapest ask is under it");
    expect(s.fast).toBe(169.999);
  });
  it("reads the trend as today's sales against the week's", () => {
    const fills = [
      ...[220, 221, 219].map((p, i) => boots(p, 32, i + 1)),
      ...[200, 199, 201, 200].map((p, i) => boots(p, 32, 30 + i * 10)),
    ];
    const s = suggestPrice({
      code: "boots5",
      skills: { dodge: 32 },
      fills,
      asks: [],
      now: NOW,
    });
    expect(s.trend).toBeCloseTo(0.1, 6);
    expect(s.rising).toBe(true);
    expect(s.price).toBe(220);
    expect(s.why).toBe("what sells");
  });
  it("stays inside the range the game allows, and falls back to the game's own estimate", () => {
    const fills = [300, 301, 299].map((p, i) => boots(p, 32, i + 1));
    const game = { suggested: 504.177, min: 353, max: 806.5 };
    const low = suggestPrice({
      code: "boots5",
      skills: { dodge: 32 },
      fills,
      asks: [],
      now: NOW,
      game,
    });
    expect(low.price).toBe(353);
    expect(low.clamped).toBe(true);
    const none = suggestPrice({
      code: "boots5",
      skills: { dodge: 32 },
      fills: [],
      asks: [],
      now: NOW,
      game,
    });
    expect(none.price).toBe(504.177);
    expect(none.why).toBe("the game's estimate");
  });
  it("lists under a cheaper piece of better stats, not just under the same stats", () => {
    // the market of 11 Oct: a 297/41 jet, with 298/42 and 298/43 listed cheaper than the cheapest 297/41
    const jet = (price, attack, crit, ageMin) => ({
      price,
      skills: { attack, criticalChance: crit },
      ageMin,
    });
    const fills = [488, 494, 500, 492, 496].map((p, i) => ({
      price: p,
      at: hoursAgo(i + 1),
      skills: { attack: 297, criticalChance: 41 },
    }));
    const s = suggestPrice({
      code: "jet",
      skills: { attack: 297, criticalChance: 41 },
      fills,
      asks: [
        jet(534.999, 298, 42, 46),
        jet(535, 298, 43, 249),
        jet(544, 297, 41, 10080),
        jet(547.996, 297, 43, 300),
      ],
      now: NOW,
    });
    expect(s.price).toBe(534.998);
    expect(s.why).toBe("under better stats");
    expect(s.floor).toMatchObject({ price: 534.999, better: true });
  });
  it("does not price under a cheaper piece of worse stats", () => {
    const fills = [185, 184, 186].map((p, i) => boots(p, 35, i + 1));
    const s = suggestPrice({
      code: "boots5",
      skills: { dodge: 35 },
      fills,
      asks: [ask(170, 31, 3), ask(190, 35, 20)], // dodge 31 is worse and outside the same stats
      now: NOW,
    });
    expect(s.floor).toMatchObject({ price: 190, better: false });
    expect(s.price).toBe(189.999);
  });
  it("ignores asks of other stats", () => {
    const fills = [185, 184, 186].map((p, i) => boots(p, 32, i + 1));
    const s = suggestPrice({
      code: "boots5",
      skills: { dodge: 32 },
      fills,
      asks: [ask(150, 25, 3)], // dodge 25 is another roll
      now: NOW,
    });
    expect(s.floor).toBeNull();
    expect(s.price).toBe(185);
  });
});
