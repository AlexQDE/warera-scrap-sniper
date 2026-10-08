import { describe, it, expect, vi } from "vitest";
import {
  reduceRow,
  fetchHistoryPage,
  historyUrl,
  HISTORY_TYPES,
} from "./api.mjs";

const ME = "697b55e4bcecf3b37667e0d1";
const OTHER = "69b4b8113af735a990a8070e";
const NOW = Date.parse("2026-10-08T12:00:00Z");
const response = (data) => ({
  ok: true,
  status: 200,
  headers: new Headers({ "ratelimit-limit": "500" }),
  json: async () => ({ result: { data } }),
});
const live = {
  openCase: {
    _id: "6ac5da459572abbf5096f06a",
    itemCode: "case1",
    quantity: 1,
    sellerId: ME,
    buyerId: ME,
    transactionType: "openCase",
    item: {
      _id: "6ac5da459572abbf5096f056",
      code: "knife",
      skills: { attack: 37, criticalChance: 4 },
      state: 100,
    },
    createdAt: "2026-10-07T05:36:05.240Z",
  },
  wooden: {
    _id: "6ac5da459572abbf5096f0aa",
    itemCode: "iron",
    quantity: 50,
    sellerId: ME,
    buyerId: ME,
    transactionType: "openCase",
    createdAt: "2026-10-07T05:36:05.240Z",
  },
  sale: {
    _id: "6ac662d4306f10bf63118dcd",
    money: 4.413,
    itemCode: "gun",
    quantity: 1,
    sellerId: ME,
    buyerId: OTHER,
    transactionType: "itemMarket",
    item: {
      _id: "6ac662d4306f10bf63118dca",
      code: "gun",
      skills: { attack: 54, criticalChance: 8 },
      state: 100,
    },
    offerCreatedAt: "2026-10-07T12:59:53.515Z",
    createdAt: "2026-10-07T15:18:44.681Z",
  },
  trade: {
    _id: "6ac7150a423ddb8f0dea08fd",
    money: 11.637,
    itemCode: "case1",
    quantity: 3,
    sellerId: OTHER,
    buyerId: ME,
    transactionType: "trading",
    offerCreatedAt: "2026-10-07T22:59:15.003Z",
    createdAt: "2026-10-08T03:59:06.114Z",
  },
};

describe("reduceRow", () => {
  it("keeps what the history needs in short keys, with the player's side on market and trade rows", () => {
    expect(reduceRow(live.openCase, ME)).toEqual({
      x: "6ac5da459572abbf5096f06a",
      y: "openCase",
      a: "2026-10-07T05:36:05.240Z",
      c: "case1",
      q: 1,
      i: "6ac5da459572abbf5096f056",
      ic: "knife",
      k: { attack: 37, criticalChance: 4 },
    });
    expect(reduceRow(live.wooden, ME)).toEqual({
      x: "6ac5da459572abbf5096f0aa",
      y: "openCase",
      a: "2026-10-07T05:36:05.240Z",
      c: "iron",
      q: 50,
    });
    expect(reduceRow(live.sale, ME)).toMatchObject({
      y: "itemMarket",
      m: 4.413,
      d: -1,
      ic: "gun",
      l: "2026-10-07T12:59:53.515Z",
    });
    expect(reduceRow(live.trade, ME)).toMatchObject({
      y: "trading",
      c: "case1",
      q: 3,
      m: 11.637,
      d: 1,
    });
    expect(
      reduceRow({ ...live.sale, sellerId: OTHER, buyerId: ME }, ME).d,
    ).toBe(1);
  });
  it("drops a row without an id, a time or a known type", () => {
    expect(reduceRow({ ...live.sale, _id: undefined }, ME)).toBeNull();
    expect(reduceRow({ ...live.sale, createdAt: "never" }, ME)).toBeNull();
    expect(reduceRow({ ...live.sale, transactionType: "wage" }, ME)).toBeNull();
  });
});

describe("fetchHistoryPage", () => {
  it("asks for all six types in one walk with the player id, and hands back the next cursor", async () => {
    const fetchImpl = vi.fn(async () =>
      response({
        items: [
          live.sale,
          live.openCase,
          { ...live.trade, createdAt: "2026-10-09T00:00:00.000Z" },
        ],
        nextCursor: "c2",
      }),
    );
    const r = await fetchHistoryPage(fetchImpl, "k", ME, {
      cursor: "c1",
      now: NOW,
    });
    const input = JSON.parse(
      new URL(fetchImpl.mock.calls[0][0]).searchParams.get("input"),
    );
    expect(input).toEqual({
      transactionType: HISTORY_TYPES,
      userId: ME,
      limit: 100,
      cursor: "c1",
    });
    expect(r.rows.map((x) => x.y)).toEqual(["itemMarket", "openCase"]); // the future-dated row is dropped
    expect(r.next).toBe("c2");
    expect(historyUrl(ME)).not.toContain("cursor");
  });
  it("ends at an empty page or a missing cursor, and refuses a bad id", async () => {
    const end = vi.fn(async () => response({ items: [], nextCursor: "x" }));
    expect(
      (await fetchHistoryPage(end, "k", ME, { now: NOW })).next,
    ).toBeNull();
    await expect(fetchHistoryPage(end, "k", "nope")).rejects.toMatchObject({
      code: "schema",
    });
    const bad = vi.fn(async () => response({ items: "no" }));
    await expect(fetchHistoryPage(bad, "k", ME)).rejects.toMatchObject({
      code: "schema",
    });
  });
});
