import { describe, it, expect } from "vitest";
import {
  TICK,
  roundToTick,
  normalizeRecipe,
  inputCost,
  buyWays,
  acquisition,
  proceeds,
  listingForProceeds,
  craftEV,
  breakEven,
  craftPlan,
  rankPlans,
  rerollFloor,
} from "./craft.mjs";

// Synthetic recipe and books: the quantities are a fixture, not the game's
// recipe (see the README: the recipe is read from the game's craft screen).
const recipe = { scraps: 10, steel: 2 };

describe("roundToTick", () => {
  it("snaps down, up or nearest to the 0.001 tick", () => {
    expect(TICK).toBe(0.001);
    expect(roundToTick(1.2345)).toBe(1.234);
    expect(roundToTick(1.2345, { mode: "up" })).toBe(1.235);
    expect(roundToTick(1.2345, { mode: "nearest" })).toBe(1.235);
    expect(roundToTick(1.2344, { mode: "nearest" })).toBe(1.234);
    expect(roundToTick(1.239, { tick: 0.01 })).toBe(1.23);
  });
  it("leaves a price already on a tick alone despite floating point", () => {
    expect(roundToTick(0.3)).toBe(0.3);
    expect(roundToTick(0.1 + 0.2)).toBe(0.3);
    expect(roundToTick(0.1 + 0.2, { mode: "up" })).toBe(0.3);
    expect(roundToTick(105.26315789473684 * 0.95)).toBe(100);
    expect(roundToTick(0)).toBe(0);
  });
  it("refuses junk and a tick of nothing", () => {
    expect(roundToTick("x")).toBeNull();
    expect(roundToTick(null)).toBeNull();
    expect(roundToTick(1, { tick: 0 })).toBeNull();
  });
});

describe("normalizeRecipe", () => {
  it("accepts non-negative integer quantities with at least one input, from numbers or form strings", () => {
    expect(normalizeRecipe({ scraps: 10, steel: 2 })).toEqual({
      scraps: 10,
      steel: 2,
    });
    expect(normalizeRecipe({ scraps: "10", steel: "0" })).toEqual({
      scraps: 10,
      steel: 0,
    });
    expect(normalizeRecipe({ steel: 3 })).toEqual({ scraps: 0, steel: 3 });
  });
  it("never guesses: empty, negative, fractional or missing recipes are null", () => {
    expect(normalizeRecipe({ scraps: 0, steel: 0 })).toBeNull();
    expect(normalizeRecipe({ scraps: -1, steel: 2 })).toBeNull();
    expect(normalizeRecipe({ scraps: 1.5, steel: 2 })).toBeNull();
    expect(normalizeRecipe({ scraps: "ten" })).toBeNull();
    expect(normalizeRecipe(null)).toBeNull();
    expect(normalizeRecipe("10")).toBeNull();
  });
});

describe("inputCost", () => {
  it("multiplies quantities by the batch and prices, per craft and in total", () => {
    const c = inputCost({ recipe, batch: 3, scrapPrice: 0.2, steelPrice: 1.5 });
    expect(c).toMatchObject({
      batch: 3,
      scraps: 30,
      steel: 6,
      scrapCost: 6,
      steelCost: 9,
      total: 15,
      perCraft: 5,
      missing: [],
    });
  });
  it("leaves the total unknown when a used input has no price, and needs none for an unused one", () => {
    const c = inputCost({ recipe, scrapPrice: 0.2 });
    expect(c.total).toBeNull();
    expect(c.perCraft).toBeNull();
    expect(c.missing).toEqual(["steel price"]);
    const noSteel = inputCost({
      recipe: { scraps: 10, steel: 0 },
      scrapPrice: 0.2,
    });
    expect(noSteel.total).toBe(2);
    expect(noSteel.steelCost).toBe(0);
  });
  it("treats a bad batch as one", () => {
    expect(
      inputCost({ recipe, batch: 0, scrapPrice: 1, steelPrice: 1 }).batch,
    ).toBe(1);
    expect(
      inputCost({ recipe, batch: 2.5, scrapPrice: 1, steelPrice: 1 }).batch,
    ).toBe(1);
    expect(
      inputCost({ recipe, batch: "x", scrapPrice: 1, steelPrice: 1 }).batch,
    ).toBe(1);
  });
});

describe("buyWays", () => {
  const book = {
    bids: [
      { price: 0.2, quantity: 500 },
      { price: 0.19, quantity: 1000 },
    ],
    asks: [
      { price: 0.25, quantity: 60 },
      { price: 0.26, quantity: 100 },
    ],
  };
  it("walks the asks for an immediate buy and joins or fronts the best bid for a placed bid", () => {
    const w = buyWays(100, book);
    expect(w.immediate).toEqual({
      total: 25.4,
      average: 0.254,
      complete: true,
      filled: 100,
      bestAsk: 0.25,
    });
    expect(w.bid).toEqual({
      price: 0.2,
      total: 20,
      front: 0.201,
      frontTotal: 20.1,
    });
  });
  it("has no immediate price past the observed ask depth, only the filled part", () => {
    const w = buyWays(1000, book);
    expect(w.immediate.total).toBeNull();
    expect(w.immediate.complete).toBe(false);
    expect(w.immediate.filled).toBe(160);
    expect(w.bid.total).toBe(200);
  });
  it("has no bid to join on an empty bid side and no front bid when a tick up would cross the spread", () => {
    expect(buyWays(10, { asks: book.asks, bids: [] }).bid).toEqual({
      price: null,
      total: null,
      front: null,
      frontTotal: null,
    });
    const tight = buyWays(10, {
      asks: [{ price: 0.25, quantity: 50 }],
      bids: [{ price: 0.249, quantity: 50 }],
    });
    expect(tight.bid.price).toBe(0.249);
    expect(tight.bid.front).toBeNull();
    expect(buyWays(10, null).immediate.total).toBeNull();
  });
});

describe("acquisition", () => {
  const scrapBook = {
    bids: [{ price: 0.2, quantity: 1e6 }],
    asks: [{ price: 0.25, quantity: 1e6 }],
  };
  it("sums both inputs each way and names the input the asks cannot cover", () => {
    const a = acquisition({
      recipe,
      batch: 2,
      scrapBook,
      steelBook: {
        bids: [{ price: 1.5, quantity: 10 }],
        asks: [{ price: 1.7, quantity: 3 }],
      },
    });
    expect(a.parts.scraps.quantity).toBe(20);
    expect(a.parts.steel.quantity).toBe(4);
    expect(a.immediate.total).toBeNull();
    expect(a.immediate.complete).toBe(false);
    expect(a.immediate.missing).toEqual(["steel"]);
    expect(a.bid.total).toBeCloseTo(20 * 0.2 + 4 * 1.5, 9);
    expect(a.bid.frontTotal).toBeCloseTo(20 * 0.201 + 4 * 1.501, 9);
    expect(a.bid.missing).toEqual([]);
  });
  it("prices a covered batch at the walked asks and skips an unused input", () => {
    const a = acquisition({
      recipe: { scraps: 10, steel: 0 },
      batch: 3,
      scrapBook,
    });
    expect(Object.keys(a.parts)).toEqual(["scraps"]);
    expect(a.immediate.total).toBeCloseTo(7.5, 9);
    expect(a.immediate.complete).toBe(true);
    expect(a.bid.total).toBeCloseTo(6, 9);
  });
});

describe("proceeds and listingForProceeds", () => {
  it("takes the tax out of the seller's side once by default, or puts it on the buyer's side once", () => {
    expect(proceeds({ listing: 100, taxPct: 5 })).toEqual({
      listing: 100,
      buyerPays: 100,
      sellerGets: 95,
      tax: 5,
      taxPct: 5,
      mode: "deducted",
    });
    expect(proceeds({ listing: 100, taxPct: 5, mode: "added" })).toEqual({
      listing: 100,
      buyerPays: 105,
      sellerGets: 100,
      tax: 5,
      taxPct: 5,
      mode: "added",
    });
    const none = proceeds({ listing: 100 });
    expect(none.buyerPays).toBe(100);
    expect(none.sellerGets).toBe(100);
    expect(proceeds({ listing: null, taxPct: 5 }).sellerGets).toBeNull();
    expect(proceeds({ listing: 100, taxPct: 250 }).sellerGets).toBe(0);
    expect(proceeds({ listing: 100, taxPct: -5 }).sellerGets).toBe(100);
  });
  it("finds the listing that nets a target, on the tick, in both modes", () => {
    expect(listingForProceeds({ sellerGets: 95, taxPct: 5 })).toBe(100);
    const l = listingForProceeds({ sellerGets: 100, taxPct: 5 });
    expect(l).toBe(105.264);
    expect(
      proceeds({ listing: l, taxPct: 5 }).sellerGets,
    ).toBeGreaterThanOrEqual(100);
    expect(
      listingForProceeds({ sellerGets: 100, taxPct: 5, mode: "added" }),
    ).toBe(100);
    expect(listingForProceeds({ sellerGets: 100, taxPct: 100 })).toBeNull();
    expect(listingForProceeds({ sellerGets: null })).toBeNull();
  });
});

describe("craftEV", () => {
  it("weights every outcome by its probability; a rare good roll is not the expected result", () => {
    const ev = craftEV({
      outcomes: [
        { label: "great", p: 0.1, proceeds: 100 },
        { label: "plain", p: 0.9, proceeds: 1 },
      ],
      cost: 5,
    });
    expect(ev.status).toBe("ok");
    expect(ev.ev).toBeCloseTo(10.9, 9);
    expect(ev.profit).toBeCloseTo(5.9, 9);
    expect(ev.roi).toBeCloseTo(5.9 / 5, 9);
    expect(ev.pProfit).toBeCloseTo(0.1, 9);
    expect(ev.best).toBe(100);
    expect(ev.worst).toBe(1);
    expect(ev.coverage).toBeCloseTo(1, 9);
  });
  it("rejects probabilities that do not make a distribution", () => {
    expect(
      craftEV({ outcomes: [{ label: "a", p: 0.5, proceeds: 1 }], cost: 1 }),
    ).toMatchObject({ status: "invalid", ev: null });
    expect(
      craftEV({
        outcomes: [
          { label: "a", p: 1.2, proceeds: 1 },
          { label: "b", p: -0.2, proceeds: 1 },
        ],
        cost: 1,
      }).status,
    ).toBe("invalid");
    expect(craftEV({ outcomes: [], cost: 1 })).toMatchObject({
      status: "invalid",
      reason: "no outcomes",
    });
    expect(craftEV({ outcomes: null, cost: 1 }).status).toBe("invalid");
  });
  it("is unavailable, with the covered share, when an outcome has no value; never dropped or imputed", () => {
    const ev = craftEV({
      outcomes: [
        { label: "epic", p: 0.3, proceeds: null },
        { label: "rare", p: 0.7, proceeds: 10 },
      ],
      cost: 5,
    });
    expect(ev.status).toBe("unavailable");
    expect(ev.ev).toBeNull();
    expect(ev.missing).toEqual(["epic"]);
    expect(ev.coverage).toBeCloseTo(0.7, 9);
  });
  it("gives an EV without a cost, but no profit or ROI, and no ROI on a free craft", () => {
    const ev = craftEV({ outcomes: [{ label: "x", p: 1, proceeds: 10 }] });
    expect(ev.ev).toBe(10);
    expect(ev.profit).toBeNull();
    expect(ev.roi).toBeNull();
    expect(ev.pProfit).toBeNull();
    const free = craftEV({
      outcomes: [{ label: "x", p: 1, proceeds: 10 }],
      cost: 0,
    });
    expect(free.profit).toBe(10);
    expect(free.roi).toBeNull();
  });
});

describe("breakEven", () => {
  it("solves the most scraps may cost given the steel price, and the reverse, at break-even and at a target ROI", () => {
    const be = breakEven({
      recipe,
      expectedProceeds: 10,
      steelPrice: 1,
      scrapPrice: 0.5,
    });
    expect(be.budget).toBe(10);
    expect(be.maxScrapPrice).toEqual({ value: 0.8, reason: null });
    expect(be.maxSteelPrice).toEqual({ value: 2.5, reason: null });
    const target = breakEven({
      recipe,
      expectedProceeds: 10,
      steelPrice: 1,
      scrapPrice: 0.5,
      targetMarginPct: 25,
    });
    expect(target.budget).toBe(8);
    expect(target.maxScrapPrice.value).toBe(0.6);
    expect(target.maxSteelPrice.value).toBe(1.5);
    expect(target.targetMarginPct).toBe(25);
  });
  it("rounds the ceiling down to the tick and keeps an exact tick exact", () => {
    expect(
      breakEven({ recipe, expectedProceeds: 10, steelPrice: 1.2345 })
        .maxScrapPrice.value,
    ).toBe(0.753); // (10 - 2.469) / 10 = 0.7531
    expect(
      breakEven({ recipe: { scraps: 1, steel: 0 }, expectedProceeds: 0.3 })
        .maxScrapPrice.value,
    ).toBe(0.3);
    expect(
      breakEven({ recipe: { scraps: 3, steel: 0 }, expectedProceeds: 1 })
        .maxScrapPrice.value,
    ).toBe(0.333);
  });
  it("says why there is no ceiling: no proceeds, an unused input, a missing price, or the other input eating the budget", () => {
    expect(
      breakEven({ recipe, expectedProceeds: null, steelPrice: 1 }).maxScrapPrice
        .reason,
    ).toBe("expected proceeds unknown");
    expect(
      breakEven({ recipe: { scraps: 10, steel: 0 }, expectedProceeds: 10 })
        .maxSteelPrice.reason,
    ).toBe("the recipe uses none");
    expect(
      breakEven({ recipe: { scraps: 10, steel: 0 }, expectedProceeds: 10 })
        .maxScrapPrice.value,
    ).toBe(1);
    expect(
      breakEven({ recipe, expectedProceeds: 10 }).maxScrapPrice.reason,
    ).toBe("steel price unknown");
    expect(
      breakEven({ recipe, expectedProceeds: 10, steelPrice: 6 }).maxScrapPrice,
    ).toEqual({
      value: null,
      reason: "steel alone costs more than the budget",
    });
    expect(
      breakEven({ recipe, expectedProceeds: 10, steelPrice: 5 }).maxScrapPrice
        .value,
    ).toBe(0); // exactly the budget: nothing left for scraps
  });
  it("widens the budget for a negative target the way the equipment panel allows near misses", () => {
    expect(
      breakEven({
        recipe: { scraps: 1, steel: 0 },
        expectedProceeds: 9,
        targetMarginPct: -10,
      }).budget,
    ).toBeCloseTo(10, 9);
  });
});

describe("craftPlan and rankPlans", () => {
  const outcomes = [{ label: "sold", p: 1, proceeds: 10 }];
  it("works a tier through: cost, EV, batch totals and both ceilings", () => {
    const plan = craftPlan({
      recipe,
      batch: 4,
      scrapPrice: 0.2,
      steelPrice: 1,
      outcomes,
      targetMarginPct: 20,
    });
    expect(plan.cost.perCraft).toBe(4);
    expect(plan.ev.profit).toBe(6);
    expect(plan.ev.roi).toBe(1.5);
    expect(plan.batch).toEqual({
      size: 4,
      cost: 16,
      expectedProceeds: 40,
      expectedProfit: 24,
    });
    expect(plan.breakEven.maxScrapPrice.value).toBe(0.8);
    expect(plan.target.maxScrapPrice.value).toBeCloseTo(0.633, 9); // (10/1.2 - 2) / 10 = 0.6333
  });
  it("ranks by ROI and keeps plans without an EV last", () => {
    const a = {
      code: "a",
      plan: craftPlan({ recipe, scrapPrice: 0.2, steelPrice: 1, outcomes }),
    };
    const b = {
      code: "b",
      plan: craftPlan({ recipe, scrapPrice: 0.5, steelPrice: 1, outcomes }),
    };
    const c = {
      code: "c",
      plan: craftPlan({ recipe, scrapPrice: 0.5, steelPrice: 1, outcomes: [] }),
    };
    expect(rankPlans([c, b, a]).map((p) => p.code)).toEqual(["a", "b", "c"]);
  });
});

describe("rerollFloor", () => {
  it("returns the whole scrap ladder of the rarity at the bid and writes the steel off, so a failed attempt loses less than the input", () => {
    // A legendary craft: 486 scraps + 32 steel at 0.21 / 1.6 = 153.26 g; dismantled at 100% it gives 486 scraps back, 97.2 g at the 0.2 bid.
    const floor = rerollFloor({
      rarity: "legendary",
      recipe: { scraps: 486, steel: 32 },
      cost: 153.26,
      scrapBid: 0.2,
      steelPrice: 1.6,
    });
    expect(floor).toEqual({
      scrapsBack: 486,
      scrapsValue: 97.2,
      steelLost: 32,
      steelCost: 51.2,
      loss: 56.06,
    });
    // The ladder, not the recipe, decides what comes back: an overridden recipe still dismantles into the tier's scraps.
    expect(
      rerollFloor({ rarity: "legendary", recipe, cost: 5.3, scrapBid: 0.2 })
        .scrapsBack,
    ).toBe(486);
  });
  it("leaves the value and the loss unknown without a bid, and everything null for an unknown rarity", () => {
    const noBid = rerollFloor({ rarity: "mythic", recipe, cost: 5.3 });
    expect(noBid).toMatchObject({
      scrapsBack: 1458,
      scrapsValue: null,
      loss: null,
      steelCost: null,
    });
    expect(
      rerollFloor({ rarity: "wooden", recipe, cost: 5.3, scrapBid: 0.2 }),
    ).toMatchObject({ scrapsBack: null, scrapsValue: null, loss: null });
  });
});
