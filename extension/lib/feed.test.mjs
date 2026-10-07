import { describe, it, expect, vi } from "vitest";
import { fetchOwnFeed, FEED_PAGES, ownUrl } from "./api.mjs";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const ME = "697b55e4bcecf3b37667e0d1";
const OTHER = "69b4b8113af735a990a8070e";
const iso = (hoursAgo) => new Date(NOW - hoursAgo * 3600e3).toISOString();
const oid = (n) => n.toString(16).padStart(24, "0");
const response = (data, limit = 500) => ({
  ok: true,
  status: 200,
  headers: new Headers({ "ratelimit-limit": String(limit) }),
  json: async () => ({ result: { data } }),
});
const craftRow = (n, hoursAgo, code = "boots5", skills = { dodge: 38 }) => ({
  _id: oid(n),
  itemCode: "scraps",
  quantity: 486,
  sellerId: ME,
  buyerId: ME,
  transactionType: "craftItem",
  item: { _id: oid(1000 + n), code, skills, state: 100, maxState: 100 },
  createdAt: iso(hoursAgo),
});
const marketRow = (
  n,
  hoursAgo,
  {
    seller = OTHER,
    buyer = ME,
    money = 4.413,
    code = "gun",
    itemN = 2000 + n,
  } = {},
) => ({
  _id: oid(100000 + n),
  money,
  itemCode: code,
  quantity: 1,
  sellerId: seller,
  buyerId: buyer,
  transactionType: "itemMarket",
  item: {
    _id: oid(itemN),
    code,
    skills: { attack: 54, criticalChance: 8 },
    state: 100,
    maxState: 100,
  },
  offerCreatedAt: iso(hoursAgo + 2),
  createdAt: iso(hoursAgo),
});
const dismantleRow = (n, hoursAgo) => ({
  _id: oid(200000 + n),
  itemCode: "scraps",
  quantity: 54,
  sellerId: ME,
  buyerId: ME,
  transactionType: "dismantleItem",
  item: {
    _id: oid(3000 + n),
    type: "equipment",
    code: "pants3",
    skills: { armor: 12 },
    state: 100,
    maxState: 100,
  },
  createdAt: iso(hoursAgo),
});
/** A fake API: pages of 100 per type, newest first, cursor "<type>:<page>". */
function feed(byType) {
  const calls = [];
  const fetchImpl = vi.fn(async (url) => {
    const u = new URL(url);
    const input = JSON.parse(u.searchParams.get("input"));
    const type = input.transactionType;
    const page = input.cursor ? Number(input.cursor.split(":")[1]) : 0;
    calls.push({ type, page });
    const rows = byType[type] ?? [];
    const items = rows.slice(page * 100, page * 100 + 100);
    const nextCursor =
      rows.length > (page + 1) * 100 ? `${type}:${page + 1}` : null;
    return response({ items, nextCursor });
  });
  return { fetchImpl, calls };
}
const typeOf = (feedName) =>
  ({ crafts: "craftItem", sales: "itemMarket", dismantles: "dismantleItem" })[
    feedName
  ];

describe("fetchOwnFeed", () => {
  it("reduces the three feeds to what the ledger needs, each row with its transaction id, both sides of a market row kept", async () => {
    const { fetchImpl, calls } = feed({
      craftItem: [craftRow(1, 1)],
      itemMarket: [
        marketRow(1, 1), // bought by me
        marketRow(2, 2, { seller: ME, buyer: OTHER, money: 6.1 }), // sold by me
        marketRow(3, 3, { seller: OTHER, buyer: OTHER }), // somebody else's (the API would not return it; kept as data anyway)
        { ...marketRow(4, 4), money: 0 }, // no price: dropped
      ],
      dismantleItem: [dismantleRow(1, 1)],
    });
    const r = await fetchOwnFeed(fetchImpl, "k", ME, {
      cutoff: NOW - 7 * 86400e3,
      now: NOW,
    });
    expect(r.crafts).toEqual([
      {
        txId: craftRow(1, 1)._id,
        id: oid(1001),
        code: "boots5",
        skills: { dodge: 38 },
        at: iso(1),
        scraps: 486,
      },
    ]);
    expect(
      r.sales.map((s) => [s.txId, s.buyer === ME ? "buy" : "sell", s.money]),
    ).toEqual([
      [marketRow(1, 1)._id, "buy", 4.413],
      [marketRow(2, 2)._id, "sell", 6.1],
      [marketRow(3, 3)._id, "sell", 4.413],
    ]);
    expect(r.sales[0]).toMatchObject({
      itemId: oid(2001),
      code: "gun",
      skills: { attack: 54, criticalChance: 8 },
      listedAt: iso(3),
      seller: OTHER,
    });
    expect(r.dismantles).toEqual([
      {
        txId: dismantleRow(1, 1)._id,
        itemId: oid(3001),
        code: "pants3",
        skills: { armor: 12 },
        at: iso(1),
        scraps: 54,
      },
    ]);
    expect(r.complete).toEqual({ crafts: true, sales: true, dismantles: true });
    expect(r.stopped).toEqual({
      crafts: "end",
      sales: "end",
      dismantles: "end",
    });
    expect(r.pages).toBe(3);
    expect(calls.map((c) => c.type)).toEqual([
      "craftItem",
      "itemMarket",
      "dismantleItem",
    ]);
  });
  it("stops each walk at the first known transaction id, keeping only what is newer", async () => {
    const sales = Array.from({ length: 250 }, (_, i) => marketRow(i, i * 0.5));
    const { fetchImpl, calls } = feed({
      itemMarket: sales,
      craftItem: [],
      dismantleItem: [],
    });
    const r = await fetchOwnFeed(fetchImpl, "k", ME, {
      cutoff: NOW - 30 * 86400e3,
      known: { sales: [sales[130]._id, sales[200]._id] },
      pages: FEED_PAGES.poll,
      now: NOW,
    });
    expect(r.sales).toHaveLength(130);
    expect(r.sales[0].txId).toBe(sales[0]._id);
    expect(r.sales.at(-1).txId).toBe(sales[129]._id);
    expect(r.stopped.sales).toBe("known");
    expect(r.complete.sales).toBe(true);
    expect(calls.filter((c) => c.type === "itemMarket")).toHaveLength(2);
  });
  it("stops at the cutoff, and reports a capped walk as incomplete", async () => {
    const sales = Array.from({ length: 1200 }, (_, i) => marketRow(i, i * 0.2)); // 240 h of rows
    const { fetchImpl, calls } = feed({
      itemMarket: sales,
      craftItem: [],
      dismantleItem: [],
    });
    const r = await fetchOwnFeed(fetchImpl, "k", ME, {
      cutoff: NOW - 30 * 3600e3,
      now: NOW,
    });
    expect(r.stopped.sales).toBe("cutoff");
    expect(r.sales).toHaveLength(151); // 0 .. 150 are within 30 h (150 × 0.2 = 30 h, the edge included)
    expect(calls.filter((c) => c.type === "itemMarket")).toHaveLength(2);
    const capped = await fetchOwnFeed(fetchImpl, "k", ME, {
      cutoff: NOW - 30 * 86400e3,
      pages: { crafts: 1, sales: 3, dismantles: 1 },
      now: NOW,
    });
    expect(capped.sales).toHaveLength(300);
    expect(capped.stopped.sales).toBe("cap");
    expect(capped.complete.sales).toBe(false);
  });
  it("drops doubled ids within a walk, future-dated rows and rows without a transaction id", async () => {
    const row = craftRow(1, 1);
    const { fetchImpl } = feed({
      craftItem: [
        row,
        row,
        { ...craftRow(2, 2), createdAt: new Date(NOW + 60_000).toISOString() },
        { ...craftRow(3, 3), _id: undefined },
      ],
      itemMarket: [],
      dismantleItem: [],
    });
    const r = await fetchOwnFeed(fetchImpl, "k", ME, {
      cutoff: NOW - 86400e3,
      now: NOW,
    });
    expect(r.crafts.map((c) => c.txId)).toEqual([row._id]);
  });
  it("refuses a bad player id or cutoff, and the cursor must move", async () => {
    const { fetchImpl } = feed({});
    await expect(
      fetchOwnFeed(fetchImpl, "k", "nope", { cutoff: 0 }),
    ).rejects.toMatchObject({ code: "schema" });
    await expect(
      fetchOwnFeed(fetchImpl, "k", ME, { cutoff: NaN }),
    ).rejects.toMatchObject({ code: "schema" });
    const stuck = vi.fn(async () =>
      response({ items: [craftRow(1, 1)], nextCursor: "same" }),
    );
    await expect(
      fetchOwnFeed(stuck, "k", ME, {
        cutoff: NOW - 86400e3,
        now: NOW,
        pages: { crafts: 5, sales: 1, dismantles: 1 },
      }),
    ).rejects.toMatchObject({ code: "schema" });
    expect(ownUrl(typeOf("sales"), ME)).toContain("itemMarket");
  });
});
