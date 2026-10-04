import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CRAFT_CODES,
  describeCode,
  normalizeRecipes,
  inputPrices,
  taxRate,
  outcomesFor,
} from "./craftdata.mjs";

const NOW = Date.parse("2026-10-03T12:00:00.000Z");
const iso = (msAgo = 0) => new Date(NOW - msAgo).toISOString();
const book = (bid, ask, qty = 1000) => ({
  bid,
  ask,
  bids: [{ price: bid, quantity: qty }],
  asks: [{ price: ask, quantity: qty }],
});
const state = {
  book: { at: iso(), ...book(0.2, 0.21) },
  cases: { at: iso(), books: { steel: book(1.5, 1.6) } },
  salesByCode: {},
  settings: {
    intervalSec: 30,
    craftRecipes: { boots5: { scraps: 10, steel: 2 } },
  },
};
const fills = (prices, state = 100) =>
  prices.map((price, i) => ({
    price,
    at: iso((i + 1) * 3600e3),
    state,
    code: "boots5",
  }));

describe("describeCode and recipes", () => {
  it("describes the 36 craftable codes and nothing else", () => {
    expect(CRAFT_CODES).toHaveLength(36);
    expect(describeCode("boots5")).toEqual({
      code: "boots5",
      slot: "boots",
      tier: 5,
      rarity: "legendary",
    });
    expect(describeCode("jet")).toEqual({
      code: "jet",
      slot: "weapon",
      tier: 6,
      rarity: "mythic",
    });
    expect(describeCode("scraps")).toBeNull();
  });
  it("keeps valid recipe entries by known code and drops the rest, never repairing them", () => {
    expect(
      normalizeRecipes({
        boots5: { scraps: "10", steel: 2 },
        jet: { scraps: 0, steel: 0 },
        hat: { scraps: 1 },
        knife: { scraps: -1 },
      }),
    ).toEqual({ boots5: { scraps: 10, steel: 2 } });
    expect(normalizeRecipes(null)).toEqual({});
    expect(normalizeRecipes([])).toEqual({});
  });
  it("accepts the synthetic screenshot fixture as 36 recipes and the fixture says it is synthetic", () => {
    const file = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../../fixtures/recipes.json", import.meta.url)),
        "utf8",
      ),
    );
    expect(file._comment).toMatch(/NOT the game's recipes/);
    const recipes = normalizeRecipes(file);
    expect(Object.keys(recipes)).toHaveLength(36);
    expect(recipes.knife).toEqual({ scraps: 10, steel: 1 });
    expect(recipes.jet).toEqual({ scraps: 2430, steel: 6 });
  });
});

describe("inputPrices and taxRate", () => {
  it("takes the player's price first, then the fresh best ask, and says when there is none", () => {
    const p = inputPrices(state, {}, NOW);
    expect(p.scrap).toMatchObject({
      value: 0.21,
      source: "quote",
      fresh: true,
    });
    expect(p.steel).toMatchObject({ value: 1.6, source: "quote", fresh: true });
    const manual = inputPrices(state, { scrapPrice: "0.19" }, NOW);
    expect(manual.scrap).toMatchObject({
      value: 0.19,
      source: "manual",
      note: "scraps: your price",
    });
    const stale = inputPrices(
      { ...state, book: { ...state.book, at: iso(120e3) } },
      {},
      NOW,
    );
    expect(stale.scrap.fresh).toBe(false);
    expect(stale.scrap.note).toContain("stale");
    const none = inputPrices({ settings: { intervalSec: 30 } }, {}, NOW);
    expect(none.steel).toMatchObject({ value: null, source: "none" });
    expect(none.scrap.note).toContain("no ask quote");
  });
  it("prefers a manual tax rate, then the saved one, then the page, else zero with a note", () => {
    expect(taxRate({ manual: 7, settings: 5, page: 3 })).toEqual({
      value: 7,
      source: "manual",
    });
    expect(taxRate({ settings: 5, page: 3 })).toEqual({
      value: 5,
      source: "manual",
    });
    expect(taxRate({ page: 3 })).toEqual({ value: 3, source: "page" });
    expect(taxRate({ manual: 150, page: "x" })).toMatchObject({
      value: 0,
      source: "none",
    });
    expect(taxRate()).toMatchObject({ value: 0, source: "none" });
  });
});

describe("outcomesFor", () => {
  const sales = (list, complete = true) => ({
    boots5: { code: "boots5", at: iso(), complete, fills: list },
  });
  it("has no distribution without fills, or with too few, and says so", () => {
    expect(outcomesFor("boots5", { salesByCode: {}, now: NOW })).toMatchObject({
      source: "none",
      outcomes: [],
    });
    const few = outcomesFor("boots5", {
      salesByCode: sales(fills([10, 11, 12])),
      now: NOW,
    });
    expect(few.source).toBe("none");
    expect(few.note).toBe(
      "3 of 5 comparable fills at 90–100% durability in 72 h",
    );
  });
  it("makes one sales-weighted outcome at the median once five comparable fills exist", () => {
    const o = outcomesFor("boots5", {
      salesByCode: sales(fills([10, 11, 12, 13, 14])),
      now: NOW,
    });
    expect(o.source).toBe("sales");
    expect(o.outcomes).toEqual([
      { label: "sells like the last 5 fills", p: 1, listing: 12 },
    ]);
    expect(o.note).toContain(
      "assumes a crafted piece sells like recent fills at 90–100% durability",
    );
  });
  it("compares a new craft with fills near full durability only, unless the fills carry none", () => {
    const worn = fills([10, 11, 12, 13, 14], 40);
    const o = outcomesFor("boots5", { salesByCode: sales(worn), now: NOW });
    expect(o.source).toBe("none");
    expect(o.estimate.n).toBe(0);
    const unknown = outcomesFor("boots5", {
      salesByCode: sales(worn.map((f) => ({ ...f, state: null }))),
      now: NOW,
    });
    expect(unknown.source).toBe("sales");
    expect(unknown.note).not.toContain("durability");
    const mixed = outcomesFor("boots5", {
      salesByCode: sales([...worn, ...fills([20, 21, 22, 23, 24])]),
      now: NOW,
    });
    expect(mixed.outcomes[0].listing).toBe(22);
    expect(mixed.estimate.n).toBe(5);
  });
});
