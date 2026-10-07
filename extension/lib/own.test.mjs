import { describe, it, expect } from "vitest";
import {
  fetchOwnActivity,
  fetchInputAverages,
  fetchOwner,
  fetchSales,
  ownUrl,
  tradingUrl,
  userUrl,
  isId,
} from "./api.mjs";

// The player's own feed, as probed with a key on 2026-10-05: a craft row's
// `item` is the OUTPUT piece with its roll, its `quantity` the scraps it ate;
// an item-market row carries money, both parties and when it was listed; a
// dismantle row carries the piece and the scraps it gave back.
const ME = "697b55e4bcecf3b37667e0d1";
const NOW = Date.parse("2026-10-05T10:00:00.000Z");
const at = (hoursAgo) => new Date(NOW - hoursAgo * 3600e3).toISOString();
const craft = (id, code, skills, hoursAgo, scraps = 486) => ({
  _id: `tx-${id}`,
  itemCode: "scraps",
  quantity: scraps,
  sellerId: ME,
  buyerId: ME,
  transactionType: "craftItem",
  item: { _id: id, type: "equipment", code, skills, state: 100, maxState: 100 },
  createdAt: at(hoursAgo),
});
const sale = (id, code, money, hoursAgo, seller = ME) => ({
  _id: `tx-s-${id}`,
  itemCode: code,
  quantity: 1,
  money,
  sellerId: seller,
  buyerId: seller === ME ? "6993b905cd957d3e93bc35a6" : ME,
  transactionType: "itemMarket",
  item: { _id: id, code, skills: { dodge: 38 }, state: 100 },
  offerCreatedAt: at(hoursAgo + 1),
  createdAt: at(hoursAgo),
});
const dismantle = (id, code, scraps, hoursAgo) => ({
  _id: `tx-d-${id}`,
  itemCode: "scraps",
  quantity: scraps,
  sellerId: ME,
  buyerId: ME,
  transactionType: "dismantleItem",
  item: { _id: id, code, state: 100 },
  createdAt: at(hoursAgo),
});
const ID_A = "6ac36a2b68df4b72cecefc0d";
const ID_B = "6ac36a2746ab6bd918eaf111";
const ID_C = "6ac2ca4de557c722fd5b2f4d";

/** Serves pages per transaction type from the request's own input, so one fake covers the three walks. */
const feedFake = (byType, extra = {}) => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    const u = new URL(url);
    const input = JSON.parse(u.searchParams.get("input"));
    const proc = u.pathname.split("/").pop();
    let data;
    if (proc === "transaction.getPaginatedTransactions") {
      const pages = byType[input.transactionType] ?? [{ items: [] }];
      const idx = Math.min(
        pages.findIndex(
          (p, i) => (input.cursor ?? null) === (i ? `c${i}` : null),
        ),
        pages.length - 1,
      );
      const page = pages[Math.max(0, idx)];
      data = { items: page.items, nextCursor: page.next ?? null };
    } else data = extra[proc]?.(input) ?? null;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "ratelimit-limit": "500" }),
      json: async () => ({ result: { data } }),
    };
  };
  return { fetchImpl, calls };
};

/** The transaction type a recorded request asked for. */
const typeOf = (call) =>
  JSON.parse(new URL(call.url).searchParams.get("input")).transactionType;
/** An ISO time `ms` before another. */
const before = (iso, ms) => new Date(Date.parse(iso) - ms).toISOString();
/** A fresh 24-hex item id: a 20-hex stem and a 4-digit counter. */
const oid = (stem, n) => `${stem}${String(n).padStart(4, "0")}`;
const CRAFT_STEM = "6ac36a2b68df4b72cece";
const SALE_STEM = "6ac36a2b68df4b72cecf";
const DISMANTLE_STEM = "6ac36a2b68df4b72ced0";
/** A full page of 100 rows from `make(id, hoursAgo)`, hoursAgo rising row by row, with a cursor to the next page. */
const crowd = (i, stem, firstHoursAgo, make) => ({
  items: Array.from({ length: 100 }, (_, j) =>
    make(oid(stem, i * 100 + j), firstHoursAgo + (i * 100 + j) / 1000),
  ),
  next: `c${i + 1}`,
});
const crowdCrafts = (i) =>
  crowd(i, CRAFT_STEM, 1, (id, h) => craft(id, "jet", {}, h));
const crowdSales = (i) =>
  crowd(i, SALE_STEM, 0.1, (id, h) => sale(id, "jet", 2, h));
const crowdDismantles = (i) =>
  crowd(i, DISMANTLE_STEM, 0.1, (id, h) => dismantle(id, "jet", 6, h));

describe("fetchOwnActivity", () => {
  it("walks the player's crafts (cut at the window), then market rows and dismantles (cut at the oldest craft) with the key, reduced to what the replay needs", async () => {
    const { fetchImpl, calls } = feedFake({
      craftItem: [
        {
          items: [
            craft(ID_A, "chest1", { armor: 4 }, 1, 6),
            craft(ID_B, "helmet4", { criticalDamages: "86" }, 2, 162),
            craft(ID_B, "helmet4", { criticalDamages: 86 }, 2, 162), // a repeated id is skipped
            { _id: "junk", item: { code: "jet" }, createdAt: at(3) }, // no item id: dropped
          ],
          next: "c1",
        },
        {
          items: [craft("6ac2ca4de557c722fd5b2f99", "jet", {}, 24 * 8)], // beyond 7 days: cut
        },
      ],
      itemMarket: [
        {
          items: [
            sale(ID_A, "chest1", 2.5, 0.5),
            sale(ID_C, "boots5", 187.25, 0.7, "6993b905cd957d3e93bc35a6"),
            { ...sale("x", "jet", 0, 1), money: 0 }, // no money: dropped
            sale("6ac2ca4de557c722fd5b2f98", "jet", 9, 5), // older than the oldest craft, inside the window: cut
          ],
        },
      ],
      dismantleItem: [
        {
          items: [
            dismantle(ID_C, "pants1", 6, 0.2),
            dismantle("6ac2ca4de557c722fd5b2f97", "jet", 6, 5), // likewise cut
          ],
        },
      ],
    });
    const r = await fetchOwnActivity(fetchImpl, "my-key", ME, {
      now: NOW,
      days: 7,
    });
    expect(calls[0].url).toBe(ownUrl("craftItem", ME));
    expect(calls[0].opts.headers["x-api-key"]).toBe("my-key");
    expect(calls[1].url).toBe(ownUrl("craftItem", ME, "c1"));
    expect(calls.map((c) => new URL(c.url).pathname.split("/").pop())).toEqual(
      Array(4).fill("transaction.getPaginatedTransactions"),
    );
    expect(r.crafts).toEqual([
      {
        id: ID_A,
        code: "chest1",
        skills: { armor: 4 },
        at: at(1),
        scraps: 6,
      },
      {
        id: ID_B,
        code: "helmet4",
        skills: { criticalDamages: 86 },
        at: at(2),
        scraps: 162,
      },
    ]);
    expect(r.sales).toEqual([
      {
        itemId: ID_A,
        code: "chest1",
        at: at(0.5),
        money: 2.5,
        seller: ME,
        buyer: "6993b905cd957d3e93bc35a6",
        listedAt: at(1.5),
      },
      {
        itemId: ID_C,
        code: "boots5",
        at: at(0.7),
        money: 187.25,
        seller: "6993b905cd957d3e93bc35a6",
        buyer: ME,
        listedAt: at(1.7),
      },
    ]);
    expect(r.dismantles).toEqual([
      { itemId: ID_C, code: "pants1", at: at(0.2), scraps: 6 },
    ]);
    expect(r.complete).toEqual({ crafts: true, sales: true, dismantles: true });
    expect(r.pages).toBe(4);
    expect(r.days).toBe(7);
  });
  it("caps the pages per type with its own cap and says which feed was not covered", async () => {
    const { fetchImpl, calls } = feedFake({
      craftItem: [crowdCrafts(0), crowdCrafts(1), crowdCrafts(2)],
      itemMarket: [crowdSales(0), crowdSales(1), crowdSales(2)],
      dismantleItem: [crowdDismantles(0), crowdDismantles(1)],
    });
    const r = await fetchOwnActivity(fetchImpl, "k", ME, {
      now: NOW,
      maxPages: 1,
      salesPages: 2,
      dismantlePages: 1,
    });
    expect(r.crafts).toHaveLength(100);
    expect(r.sales).toHaveLength(200);
    expect(r.dismantles).toHaveLength(100);
    expect(r.complete).toEqual({
      crafts: false,
      sales: false,
      dismantles: false,
    });
    expect(calls.filter((c) => typeOf(c) === "craftItem")).toHaveLength(1);
    expect(calls.filter((c) => typeOf(c) === "itemMarket")).toHaveLength(2);
    expect(calls.filter((c) => typeOf(c) === "dismantleItem")).toHaveLength(1);
    expect(r.pages).toBe(4);
  });
  it("keeps the caps apart: a feed that ends inside its own cap is complete while a capped one is not", async () => {
    const { fetchImpl } = feedFake({
      craftItem: [crowdCrafts(0), crowdCrafts(1)],
      itemMarket: [
        {
          items: [sale(oid(SALE_STEM, 1), "jet", 2, 0.2)],
          next: "c1",
        },
        { items: [sale(oid(SALE_STEM, 2), "jet", 2, 0.3)] }, // the feed ends here
      ],
      dismantleItem: [crowdDismantles(0), crowdDismantles(1)],
    });
    const r = await fetchOwnActivity(fetchImpl, "k", ME, {
      now: NOW,
      maxPages: 1,
      salesPages: 2,
      dismantlePages: 1,
    });
    expect(r.sales).toHaveLength(2);
    expect(r.complete).toEqual({
      crafts: false,
      sales: true,
      dismantles: false,
    });
  });
  it("defaults to 5 craft pages, 25 market pages and 10 dismantle pages", async () => {
    const endless = (stem, firstHoursAgo, make) =>
      Array.from({ length: 40 }, (_, i) => crowd(i, stem, firstHoursAgo, make));
    const { fetchImpl, calls } = feedFake({
      // the oldest of the 500 crafts kept is ~5.5 h back, older than every market and dismantle row the caps allow
      craftItem: endless(CRAFT_STEM, 5, (id, h) => craft(id, "jet", {}, h)),
      itemMarket: endless(SALE_STEM, 0.01, (id, h) => sale(id, "jet", 2, h)),
      dismantleItem: endless(DISMANTLE_STEM, 0.01, (id, h) =>
        dismantle(id, "jet", 6, h),
      ),
    });
    const r = await fetchOwnActivity(fetchImpl, "k", ME, { now: NOW });
    expect(calls.filter((c) => typeOf(c) === "craftItem")).toHaveLength(5);
    expect(calls.filter((c) => typeOf(c) === "itemMarket")).toHaveLength(25);
    expect(calls.filter((c) => typeOf(c) === "dismantleItem")).toHaveLength(10);
    expect(r.complete).toEqual({
      crafts: false,
      sales: false,
      dismantles: false,
    });
  });
  it("stops the item-market walk at the page that reaches one minute before the oldest craft, however many pages the window would allow", async () => {
    const S = (n) => oid(SALE_STEM, n);
    const { fetchImpl, calls } = feedFake({
      craftItem: [{ items: [craft(ID_A, "chest1", { armor: 4 }, 10)] }],
      itemMarket: [
        {
          items: [sale(S(1), "jet", 2, 1), sale(S(2), "jet", 2, 2)],
          next: "c1",
        },
        {
          items: [sale(S(3), "jet", 2, 6), sale(S(4), "jet", 2, 9)],
          next: "c2",
        },
        {
          items: [
            sale(S(5), "jet", 2, 10), // the craft's own second: kept
            sale(S(6), "jet", 2, 10 + 2 / 60), // two minutes before the craft: the cut
            sale(S(7), "jet", 2, 11),
          ],
          next: "c3",
        },
        { items: [sale(S(8), "jet", 2, 20)] }, // inside the 7 days, never asked for
      ],
    });
    const r = await fetchOwnActivity(fetchImpl, "k", ME, { now: NOW });
    const market = calls.filter((c) => typeOf(c) === "itemMarket");
    expect(market.map((c) => c.url)).toEqual([
      ownUrl("itemMarket", ME),
      ownUrl("itemMarket", ME, "c1"),
      ownUrl("itemMarket", ME, "c2"),
    ]);
    expect(r.sales.map((x) => x.itemId)).toEqual([1, 2, 3, 4, 5].map(S));
    expect(r.complete.sales).toBe(true);
    expect(r.pages).toBe(1 + 3 + 1);
  });
  it("asks for no market or dismantle rows when no craft is in the window", async () => {
    for (const craftItem of [
      [{ items: [] }],
      [{ items: [craft(ID_A, "chest1", {}, 24 * 8)] }], // only a craft beyond 7 days
    ]) {
      const { fetchImpl, calls } = feedFake({
        craftItem,
        itemMarket: [{ items: [sale(ID_A, "chest1", 2.5, 0.5)] }],
        dismantleItem: [{ items: [dismantle(ID_C, "pants1", 6, 0.2)] }],
      });
      const r = await fetchOwnActivity(fetchImpl, "k", ME, { now: NOW });
      expect(calls.map(typeOf)).toEqual(["craftItem"]);
      expect(r.crafts).toEqual([]);
      expect(r.sales).toEqual([]);
      expect(r.dismantles).toEqual([]);
      expect(r.complete).toEqual({
        crafts: true,
        sales: true,
        dismantles: true,
      });
      expect(r.pages).toBe(1);
    }
  });
  it("keeps a sale or dismantle recorded 30 s before the oldest craft and cuts one 2 minutes before", async () => {
    const craftAt = at(5);
    const { fetchImpl } = feedFake({
      craftItem: [{ items: [craft(ID_A, "chest1", { armor: 4 }, 5)] }],
      itemMarket: [
        {
          items: [
            { ...sale(ID_B, "jet", 2, 5), createdAt: before(craftAt, 30e3) },
            { ...sale(ID_C, "jet", 2, 5), createdAt: before(craftAt, 120e3) },
          ],
        },
      ],
      dismantleItem: [
        {
          items: [
            {
              ...dismantle(ID_B, "jet", 6, 5),
              createdAt: before(craftAt, 30e3),
            },
            {
              ...dismantle(ID_C, "jet", 6, 5),
              createdAt: before(craftAt, 120e3),
            },
          ],
        },
      ],
    });
    const r = await fetchOwnActivity(fetchImpl, "k", ME, { now: NOW });
    expect(r.sales.map((x) => x.itemId)).toEqual([ID_B]);
    expect(r.dismantles.map((x) => x.itemId)).toEqual([ID_B]);
    expect(r.complete.sales).toBe(true);
    expect(r.complete.dismantles).toBe(true);
  });
  it("refuses an id that is not a player id, and the schema check is a typed error", async () => {
    const { fetchImpl } = feedFake({});
    await expect(
      fetchOwnActivity(fetchImpl, "k", "../x"),
    ).rejects.toMatchObject({ code: "schema" });
    expect(isId(ME)).toBe(true);
    expect(isId("697B55E4BCECF3B37667E0D1")).toBe(false);
  });
});

describe("fetchInputAverages and fetchOwner", () => {
  it("maps each resource's daily averages by UTC day, skipping unusable days", async () => {
    const { fetchImpl, calls } = feedFake(
      {},
      {
        "itemTrading.getItemTrading": ({ itemCode }) => ({
          itemCode,
          values: [
            {
              valueAt: "2026-10-04",
              avgValue: itemCode === "scraps" ? 0.2496 : 1.78,
            },
            {
              valueAt: "2026-10-05",
              avgValue: itemCode === "scraps" ? 0.2478 : 1.7898,
            },
            { valueAt: "bad", avgValue: 1 },
            { valueAt: "2026-10-06", avgValue: 0 },
          ],
        }),
      },
    );
    const r = await fetchInputAverages(fetchImpl, "k");
    expect(calls.map((c) => c.url)).toEqual([
      tradingUrl("scraps"),
      tradingUrl("steel"),
    ]);
    expect(r.averages).toEqual({
      scraps: { "2026-10-04": 0.2496, "2026-10-05": 0.2478 },
      steel: { "2026-10-04": 1.78, "2026-10-05": 1.7898 },
    });
  });
  it("names the player behind the id and tolerates a missing card", async () => {
    const { fetchImpl, calls } = feedFake(
      {},
      {
        "user.getUserLite": ({ userId }) =>
          userId === ME ? { _id: ME, username: "Johnny_Sins" } : null,
      },
    );
    expect(await fetchOwner(fetchImpl, "k", ME)).toEqual({
      username: "Johnny_Sins",
    });
    expect(calls[0].url).toBe(userUrl(ME));
    expect(
      await fetchOwner(fetchImpl, "k", "6993b905cd957d3e93bc35a6"),
    ).toEqual({ username: null });
  });
});

describe("fetchSales carries the roll and the listing time", () => {
  it("keeps numeric skills and offerCreatedAt on every fill, null when the row has none", async () => {
    const { fetchImpl } = feedFake({
      itemMarket: [
        {
          items: [
            sale(ID_C, "boots5", 187.25, 0.7, "6993b905cd957d3e93bc35a6"),
            {
              ...sale(ID_A, "boots5", 180, 1),
              item: { _id: ID_A, code: "boots5", state: 100, skills: {} },
              offerCreatedAt: undefined,
            },
          ],
        },
      ],
    });
    const r = await fetchSales(fetchImpl, "k", "boots5", { now: NOW });
    expect(r.fills[0]).toMatchObject({
      price: 187.25,
      skills: { dodge: 38 },
      listedAt: at(1.7),
    });
    expect(r.fills[1]).toMatchObject({
      price: 180,
      skills: null,
      listedAt: null,
    });
  });
});
