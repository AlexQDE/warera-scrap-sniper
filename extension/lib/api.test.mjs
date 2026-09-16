import { describe, it, expect } from "vitest";
import {
  BOOK_URL,
  KEYLESS_LIMIT,
  ApiError,
  fetchBook,
  fetchSales,
  salesUrl,
  holdUntil,
} from "./api.mjs";

// The API, probed 2026-09-03: a request with a WRONG key is not refused, it is
// answered from the keyless bucket (ratelimit-limit 100); an accepted key gets
// a bigger bucket (500). So "was the key accepted" is read off that header.
const order = (type, price, quantity) => ({
  _id: "x",
  user: "u",
  itemCode: "scraps",
  quantity,
  price,
  offerAt: "2026-09-03T10:00:00.000Z",
  type,
  __v: 0,
});
const BODY = {
  result: {
    data: {
      buyOrders: [order("buy", 0.225, 100)],
      sellOrders: [order("sell", 0.226, 50)],
    },
  },
};

const fake = ({
  status = 200,
  limit = 500,
  remaining = 499,
  reset = 60,
  body = BODY,
} = {}) => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({
        "ratelimit-limit": String(limit),
        "ratelimit-remaining": String(remaining),
        "ratelimit-reset": String(reset),
      }),
      json: async () => body,
    };
  };
  return { fetchImpl, calls };
};

describe("fetchBook", () => {
  it("sends the key as x-api-key and returns the summarised book with its rate bucket", async () => {
    const { fetchImpl, calls } = fake();
    const r = await fetchBook(fetchImpl, "my-key");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(BOOK_URL);
    expect(calls[0].opts.headers["x-api-key"]).toBe("my-key");
    expect(r.book.bid).toBe(0.225);
    expect(r.book.ask).toBe(0.226);
    expect(r.limit).toBe(500);
    expect(r.remaining).toBe(499);
  });

  it("refuses to call the API without a key", async () => {
    const { fetchImpl, calls } = fake();
    await expect(fetchBook(fetchImpl, "")).rejects.toMatchObject({
      code: "no-key",
    });
    await expect(fetchBook(fetchImpl, "   ")).rejects.toMatchObject({
      code: "no-key",
    });
    expect(calls).toHaveLength(0);
  });

  it("treats an answer from the keyless bucket as a rejected key and discards the data", async () => {
    const { fetchImpl } = fake({ limit: KEYLESS_LIMIT, remaining: 99 });
    const err = await fetchBook(fetchImpl, "wrong-key").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("key-rejected");
    expect(err.book).toBeUndefined();
  });

  it("reports a rate limit with the seconds until reset", async () => {
    const { fetchImpl } = fake({ status: 429, reset: 37, body: {} });
    await expect(fetchBook(fetchImpl, "k")).rejects.toMatchObject({
      code: "rate-limited",
      retryAfter: 37,
      status: 429,
    });
  });

  it("surfaces an error envelope from the API", async () => {
    const { fetchImpl } = fake({ body: { error: { message: "boom" } } });
    const err = await fetchBook(fetchImpl, "k").catch((e) => e);
    expect(err.code).toBe("api");
    expect(err.message).toContain("boom");
  });

  it("surfaces other HTTP failures with their status", async () => {
    const { fetchImpl } = fake({ status: 503, body: {} });
    await expect(fetchBook(fetchImpl, "k")).rejects.toMatchObject({
      code: "http",
      status: 503,
    });
  });
});

// transaction.getPaginatedTransactions with itemCode (documented in openapi.json)
// and no userId is the global feed of one item's market fills, newest first,
// 100 per page with a cursor. Probed 2026-09-03: 100 jet fills spanned ~30 h.
const NOW = Date.parse("2026-09-03T20:00:00.000Z");
const fill = (hoursAgo, money, code = "jet") => ({
  _id: `${hoursAgo}:${money}:${code}`,
  money,
  itemCode: code,
  quantity: 1,
  transactionType: "itemMarket",
  item: { code, state: 100, skills: {} },
  createdAt: new Date(NOW - hoursAgo * 3600e3).toISOString(),
});
const pagedFake = (pages, { limit = 500 } = {}) => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    const cursor = new URL(url).searchParams.get("input");
    const idx = Math.min(calls.length - 1, pages.length - 1);
    const page = pages[idx];
    return {
      ok: true,
      status: 200,
      headers: new Headers({
        "ratelimit-limit": String(limit),
        "ratelimit-remaining": "400",
        "ratelimit-reset": "60",
      }),
      json: async () => ({
        result: { data: { items: page.items, nextCursor: page.next ?? null } },
      }),
      _cursorInput: cursor,
    };
  };
  return { fetchImpl, calls };
};

describe("fetchSales", () => {
  it("asks for the item code with the key and stops once the window is covered", async () => {
    const { fetchImpl, calls } = pagedFake([
      { items: [fill(1, 383.8), fill(20, 390), fill(60, 379.2)], next: "c2" },
      { items: [fill(71, 401), fill(80, 350), fill(90, 340)], next: "c3" },
    ]);
    const r = await fetchSales(fetchImpl, "my-key", "jet", {
      hours: 72,
      now: NOW,
      maxPages: 5,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(salesUrl("jet"));
    expect(calls[0].opts.headers["x-api-key"]).toBe("my-key");
    expect(calls[1].url).toBe(salesUrl("jet", "c2"));
    expect(r.fills.map((f) => f.price)).toEqual([383.8, 390, 379.2, 401]);
    expect(r.fills[0]).toMatchObject({ price: 383.8, state: 100, code: "jet" });
    expect(r.pages).toBe(2);
    expect(r.complete).toBe(true);
  });

  it("stops at the last page even when the window is not yet covered", async () => {
    const { fetchImpl, calls } = pagedFake([
      { items: [fill(1, 100, "knife"), fill(2, 101, "knife")], next: null },
    ]);
    const r = await fetchSales(fetchImpl, "k", "knife", {
      hours: 72,
      now: NOW,
    });
    expect(calls).toHaveLength(1);
    expect(r.fills).toHaveLength(2);
    expect(r.complete).toBe(true);
  });

  it("caps the pages it will walk and says the window is incomplete", async () => {
    const pages = [0, 1, 2].map((p) => ({
      items: Array.from({ length: 100 }, (_, i) =>
        fill(p + i / 100, 10, "gloves4"),
      ),
      next: `page-${p + 1}`,
    }));
    const { fetchImpl, calls } = pagedFake(pages);
    const r = await fetchSales(fetchImpl, "k", "gloves4", {
      hours: 72,
      now: NOW,
      maxPages: 2,
    });
    expect(calls).toHaveLength(2);
    expect(r.fills).toHaveLength(200);
    expect(r.pages).toBe(2);
    expect(r.complete).toBe(false);
  });

  it("refuses without a key and rejects a keyless-bucket answer", async () => {
    const { fetchImpl, calls } = pagedFake([
      { items: [fill(1, 1)], next: null },
    ]);
    await expect(
      fetchSales(fetchImpl, "", "jet", { now: NOW }),
    ).rejects.toMatchObject({ code: "no-key" });
    expect(calls).toHaveLength(0);
    const keyless = pagedFake([{ items: [fill(1, 1)], next: null }], {
      limit: KEYLESS_LIMIT,
    });
    await expect(
      fetchSales(keyless.fetchImpl, "wrong", "jet", { now: NOW }),
    ).rejects.toMatchObject({ code: "key-rejected" });
  });
});

// A malformed row must not end the walk: only a VALID timestamp older than the
// cutoff says the window is covered.
describe("fetchSales row hygiene", () => {
  it("skips a fill with an unreadable date instead of ending the walk there", async () => {
    const bad = { ...fill(2, 200), createdAt: undefined };
    const { fetchImpl, calls } = pagedFake([
      { items: [fill(1, 383.8), bad, fill(3, 390)], next: "c2" },
      { items: [fill(80, 350)], next: "c3" },
    ]);
    const r = await fetchSales(fetchImpl, "k", "jet", { hours: 72, now: NOW });
    expect(r.fills.map((f) => f.price)).toEqual([383.8, 390]);
    expect(calls).toHaveLength(2); // the walk went on to the page that really ends the window
    expect(r.complete).toBe(true);
  });

  it("skips a fill whose price is not a number", async () => {
    const { fetchImpl } = pagedFake([
      { items: [fill(1, "abc"), fill(2, 5)], next: null },
    ]);
    const r = await fetchSales(fetchImpl, "k", "jet", { hours: 72, now: NOW });
    expect(r.fills.map((f) => f.price)).toEqual([5]);
  });
});

describe("timeouts and network failures", () => {
  const hanging = (url, opts) =>
    new Promise((_, reject) =>
      opts.signal.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      ),
    );

  it("gives up on a call that does not answer in time", async () => {
    await expect(
      fetchBook(hanging, "k", { timeoutMs: 20 }),
    ).rejects.toMatchObject({ code: "timeout" });
    await expect(
      fetchSales(hanging, "k", "jet", { now: NOW, timeoutMs: 20 }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("reports an unreachable API as a network error, not an internal one", async () => {
    const down = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(fetchBook(down, "k")).rejects.toMatchObject({
      code: "network",
    });
  });
});

describe("holdUntil", () => {
  it("holds for the reset the API asked for, within sane bounds", () => {
    expect(holdUntil(37, 1000)).toBe(1000 + 37_000);
    expect(holdUntil(1, 1000)).toBe(1000 + 5_000); // never hammer
    expect(holdUntil(9999, 1000)).toBe(1000 + 9_999_000); // honor long server cooldowns
    expect(holdUntil(undefined, 1000)).toBe(1000 + 60_000);
  });
});

// v0.26 cases and trips (2026-09-16). Two procedures the client uses but
// openapi.json does not list, both answering an accepted key at bucket 500:
// tradingOrder.getTopOrdersPerItemCode (one call, every code) and
// gameStat.getEquipmentAvgByCode (the "Current value" the game prints on a
// tile). tRPC GET batching (?batch=1) verified live: a batch of 3 counted as
// ONE request against the minute bucket (499 -> 498).
import {
  booksUrl,
  batchUrls,
  fetchBooks,
  fetchEquipmentAvg,
  BATCH_URL_BUDGET,
} from "./api.mjs";

const top = (code, bid, ask) => ({
  buyOrders:
    bid == null
      ? []
      : [
          {
            _id: "b",
            user: "u",
            itemCode: code,
            quantity: 40,
            price: bid,
            type: "buy",
          },
        ],
  sellOrders:
    ask == null
      ? []
      : [
          {
            _id: "s",
            user: "u",
            itemCode: code,
            quantity: 7,
            price: ask,
            type: "sell",
          },
        ],
});

describe("batchUrls", () => {
  it("builds one tRPC batch URL with positional inputs", () => {
    const urls = batchUrls("gameStat.getEquipmentAvgByCode", [
      { itemCode: "jet" },
      { itemCode: "knife" },
    ]);
    expect(urls).toHaveLength(1);
    expect(urls[0].url).toBe(
      "https://api2.warera.io/trpc/gameStat.getEquipmentAvgByCode,gameStat.getEquipmentAvgByCode?batch=1&input=" +
        encodeURIComponent(
          JSON.stringify({ 0: { itemCode: "jet" }, 1: { itemCode: "knife" } }),
        ),
    );
    expect(urls[0].count).toBe(2);
  });

  it("splits by URL length, never by a fixed count, and keeps the order", () => {
    const inputs = Array.from({ length: 36 }, (_, i) => ({
      itemCode: `helmet${i}`,
    }));
    const urls = batchUrls("gameStat.getEquipmentAvgByCode", inputs);
    expect(urls.length).toBeGreaterThan(1);
    for (const u of urls)
      expect(u.url.length).toBeLessThanOrEqual(BATCH_URL_BUDGET);
    expect(urls.reduce((s, u) => s + u.count, 0)).toBe(36);
    expect(batchUrls("x.y", [])).toEqual([]);
  });
});

describe("fetchBooks", () => {
  it("reads every code in one call and flattens the best bid and ask per code", async () => {
    const { fetchImpl, calls } = fake({
      body: {
        result: {
          data: {
            woodenCase: top("woodenCase", 7.5, 7.647),
            oil: top("oil", 0.226, 0.242),
            scraps: top("scraps", null, 0.223),
          },
        },
      },
    });
    const r = await fetchBooks(fetchImpl, "my-key", [
      "woodenCase",
      "oil",
      "scraps",
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(booksUrl(["woodenCase", "oil", "scraps"]));
    expect(calls[0].opts.headers["x-api-key"]).toBe("my-key");
    expect(r.books.woodenCase).toMatchObject({
      bid: 7.5,
      ask: 7.647,
      bidQty: 40,
      askQty: 7,
    });
    expect(r.books.scraps).toMatchObject({
      bid: null,
      ask: 0.223,
      bidQty: 0,
      askQty: 7,
    });
    expect(r.source).toBe("getTopOrdersPerItemCode");
    expect(r.limit).toBe(500);
  });

  it("falls back to the documented getTopOrders, batched, when the multi-code procedure is gone", async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, opts });
      const headers = new Headers({
        "ratelimit-limit": "500",
        "ratelimit-remaining": "400",
        "ratelimit-reset": "60",
      });
      if (url.includes("getTopOrdersPerItemCode"))
        return {
          ok: false,
          status: 404,
          headers,
          json: async () => ({
            error: { message: "No procedure found on path" },
          }),
        };
      return {
        ok: true,
        status: 200,
        headers,
        json: async () => [
          { result: { data: top("oil", 0.226, 0.242) } },
          { result: { data: top("scraps", 0.221, 0.223) } },
        ],
      };
    };
    const r = await fetchBooks(fetchImpl, "k", ["oil", "scraps"]);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain(
      "tradingOrder.getTopOrders,tradingOrder.getTopOrders?batch=1",
    );
    expect(r.books.oil.bid).toBe(0.226);
    expect(r.books.scraps.ask).toBe(0.223);
    expect(r.source).toBe("getTopOrders");
  });

  it("refuses without a key and rejects a keyless-bucket answer", async () => {
    const { fetchImpl, calls } = fake();
    await expect(fetchBooks(fetchImpl, "", ["oil"])).rejects.toMatchObject({
      code: "no-key",
    });
    expect(calls).toHaveLength(0);
    const keyless = fake({
      limit: KEYLESS_LIMIT,
      body: { result: { data: { oil: top("oil", 1, 2) } } },
    });
    await expect(
      fetchBooks(keyless.fetchImpl, "wrong", ["oil"]),
    ).rejects.toMatchObject({ code: "key-rejected" });
  });
});

describe("fetchEquipmentAvg", () => {
  it("reads the average price per code through batches and keys the numbers by code", async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, opts });
      const input = JSON.parse(new URL(url).searchParams.get("input"));
      const out = Object.values(input).map((i) =>
        i.itemCode === "broken"
          ? { error: { message: "nope" } }
          : { result: { data: i.itemCode.length * 10 } },
      );
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          "ratelimit-limit": "500",
          "ratelimit-remaining": "400",
          "ratelimit-reset": "60",
        }),
        json: async () => out,
      };
    };
    const r = await fetchEquipmentAvg(fetchImpl, "k", [
      "jet",
      "knife",
      "broken",
      "helmet3",
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.headers["x-api-key"]).toBe("k");
    expect(r.avg).toEqual({ jet: 30, knife: 50, broken: null, helmet3: 70 });
    expect(r.missing).toEqual(["broken"]);
  });

  it("refuses without a key", async () => {
    const { fetchImpl, calls } = fake();
    await expect(
      fetchEquipmentAvg(fetchImpl, " ", ["jet"]),
    ).rejects.toMatchObject({ code: "no-key" });
    expect(calls).toHaveLength(0);
  });
});

// The game's tile prints `value || 0`: a code with no sales answers 0, which is
// no data, never a price of zero.
describe("fetchEquipmentAvg treats zero as missing", () => {
  it("drops a 0 and names it, keeps real prices", async () => {
    const fetchImpl = async (url) => {
      const input = JSON.parse(new URL(url).searchParams.get("input"));
      const out = Object.values(input).map((i) => ({
        result: { data: i.itemCode === "helmet6" ? 0 : 12.5 },
      }));
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          "ratelimit-limit": "500",
          "ratelimit-remaining": "400",
          "ratelimit-reset": "60",
        }),
        json: async () => out,
      };
    };
    const r = await fetchEquipmentAvg(fetchImpl, "k", ["jet", "helmet6"]);
    expect(r.avg).toEqual({ jet: 12.5, helmet6: null });
    expect(r.missing).toEqual(["helmet6"]);
  });
});
