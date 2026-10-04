import { describe, it, expect } from "vitest";
import {
  CRAFT_CODES,
  GAME_RECIPES,
  describeCode,
  normalizeRecipes,
  recipeFor,
  inputPrices,
  taxRate,
  outcomesFor,
  applyRecipeOps,
  randomCraft,
} from "./craftdata.mjs";
import { craftRecipe, SCRAP_LADDER, CRAFT_STEEL } from "./ladder.mjs";

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
  it("ships the game's recipe for all 36 codes: the tier's scrap value in scraps and twice the base steel for a chosen slot", () => {
    expect(Object.keys(GAME_RECIPES)).toHaveLength(36);
    expect(GAME_RECIPES.knife).toEqual({ scraps: 6, steel: 2 });
    expect(GAME_RECIPES.boots5).toEqual({ scraps: 486, steel: 32 });
    expect(GAME_RECIPES.jet).toEqual({ scraps: 1458, steel: 64 });
    for (const code of CRAFT_CODES) {
      const { rarity } = describeCode(code);
      expect(GAME_RECIPES[code]).toEqual({
        scraps: SCRAP_LADDER[rarity],
        steel: 2 * CRAFT_STEEL[rarity],
      });
    }
    expect(craftRecipe("mythic", { chosen: false })).toEqual({
      scraps: 1458,
      steel: 32,
    });
    expect(craftRecipe("wooden")).toBeNull();
    expect(normalizeRecipes(GAME_RECIPES)).toEqual(GAME_RECIPES); // the table passes its own validation
  });
  it("works from the player's override when there is one, else the game's recipe, and labels both", () => {
    expect(recipeFor("boots5", { boots5: { scraps: 10, steel: 2 } })).toEqual({
      value: { scraps: 10, steel: 2 },
      source: "manual",
      note: "your recipe, stored on this browser (the game's table says 486 scraps + 32 steel)",
    });
    expect(recipeFor("boots5", {})).toEqual({
      value: { scraps: 486, steel: 32 },
      source: "game",
      note: "the game's recipe, slot chosen: 486 scraps + 32 steel (a random craft of this tier burns half the steel, 16)",
    });
    expect(recipeFor("jet").value).toEqual({ scraps: 1458, steel: 64 });
    expect(recipeFor("scraps", { scraps: { scraps: 1, steel: 1 } })).toEqual({
      value: null,
      source: "none",
      note: "not a craftable item",
    });
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
    expect(mixed.fills).toHaveLength(5); // the comparable list, for the pace and the ranks
    expect(outcomesFor("boots5", { salesByCode: {}, now: NOW }).fills).toEqual(
      [],
    );
  });
});

describe("randomCraft", () => {
  it("prices a random craft at the base steel with the slot odds over the tier's six codes, and counts the covered slots", () => {
    const listings = {
      tank: 200,
      helmet5: 100,
      chest5: 100,
      gloves5: 100,
      pants5: 100,
      boots5: 150,
    };
    const r = randomCraft(5, (code) => listings[code] ?? null);
    expect(r.rarity).toBe("legendary");
    expect(r.recipe).toEqual({ scraps: 486, steel: 16 });
    expect(r.outcomes.map((o) => o.p)).toEqual([
      0.3, 0.14, 0.14, 0.14, 0.14, 0.14,
    ]);
    expect(r.outcomes[0]).toEqual({
      code: "tank",
      label: "tank (30%)",
      p: 0.3,
      listing: 200,
    });
    expect(r.outcomes[5].code).toBe("boots5");
    expect(r.covered).toBe(6);
    expect(
      randomCraft(5, (code) => (code === "boots5" ? null : 100)).covered,
    ).toBe(5);
    expect(randomCraft(7, () => 1)).toBeNull();
    expect(randomCraft(0, () => 1)).toBeNull();
  });
});

describe("applyRecipeOps", () => {
  it("adds, replaces and removes codes on the stored table, validating what it sets", () => {
    const stored = {
      boots5: { scraps: 10, steel: 2 },
      jet: { scraps: 30, steel: 3 },
    };
    expect(
      applyRecipeOps(stored, {
        set: {
          knife: { scraps: "5", steel: 1 },
          boots5: { scraps: 12, steel: 2 },
        },
      }),
    ).toEqual({
      boots5: { scraps: 12, steel: 2 },
      jet: { scraps: 30, steel: 3 },
      knife: { scraps: 5, steel: 1 },
    });
    expect(applyRecipeOps(stored, { remove: ["jet", "nope"] })).toEqual({
      boots5: { scraps: 10, steel: 2 },
    });
    expect(
      applyRecipeOps(stored, {
        set: { hat: { scraps: 1 }, jet: { scraps: -1 } },
      }),
    ).toEqual(stored);
    expect(applyRecipeOps(undefined, null)).toEqual({});
    expect(applyRecipeOps(stored, "junk")).toEqual(stored);
  });
});
