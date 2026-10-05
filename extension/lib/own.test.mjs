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

describe("fetchOwnActivity", () => {
  it("walks the player's crafts, market rows and dismantles with the key, cut at the window, reduced to what the replay needs", async () => {
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
          ],
        },
      ],
      dismantleItem: [{ items: [dismantle(ID_C, "pants1", 6, 0.2)] }],
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
  it("caps the pages per type and says the window was not covered", async () => {
    const page = (i) => ({
      items: Array.from({ length: 100 }, (_, j) =>
        craft(
          `6ac36a2b68df4b72cece${String(i * 100 + j).padStart(4, "0")}`,
          "jet",
          {},
          1 + (i * 100 + j) / 1000,
        ),
      ),
      next: `c${i + 1}`,
    });
    const { fetchImpl } = feedFake({ craftItem: [page(0), page(1), page(2)] });
    const r = await fetchOwnActivity(fetchImpl, "k", ME, {
      now: NOW,
      maxPages: 2,
    });
    expect(r.crafts).toHaveLength(200);
    expect(r.complete.crafts).toBe(false);
    expect(r.complete.sales).toBe(true);
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
