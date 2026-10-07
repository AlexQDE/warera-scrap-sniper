import { describe, it, expect, vi } from "vitest";
import { createController } from "./controller.mjs";
import { CACHE_VERSION } from "./quality.mjs";

const NOW = Date.parse("2026-09-16T12:00:00Z");
const bookData = {
  buyOrders: [{ price: 0.2, quantity: 2000 }],
  sellOrders: [{ price: 0.21, quantity: 2000 }],
};
const response = (
  data = bookData,
  { status = 200, limit = 500, batch = false } = {},
) => ({
  ok: status < 400,
  status,
  headers: new Headers({
    "ratelimit-limit": String(limit),
    "retry-after": "120",
  }),
  json: async () => (batch ? data : { result: { data } }),
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function memory(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      return structuredClone(
        keys == null
          ? data
          : Object.fromEntries(
              (Array.isArray(keys) ? keys : [keys]).map((k) => [k, data[k]]),
            ),
      );
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
  };
}
function setup(fetchImpl = vi.fn(async () => response()), initial = {}) {
  const storage = memory({ settings: { apiKey: "test-only-key" }, ...initial });
  const session = memory();
  let time = NOW;
  return {
    storage,
    session,
    fetchImpl,
    advance: (n) => {
      time += n;
    },
    controller: createController({
      storage,
      session,
      fetchImpl,
      now: () => time,
      random: () => 0,
    }),
  };
}

describe("background controller", () => {
  it("never exposes a key or accepts a content-script key write", async () => {
    const { controller, storage } = setup();
    expect(
      JSON.stringify(await controller.handle({ type: "getSettings" })),
    ).not.toContain("test-only-key");
    await controller.handle({
      type: "saveSettings",
      settings: { apiKey: "injected", intervalSec: 1, minMarginPct: Infinity },
    });
    expect(storage.data.settings.apiKey).toBe("test-only-key");
    expect(storage.data.settings.intervalSec).toBe(10);
    expect(storage.data.settings.minMarginPct).toBe(0);
    expect(
      (await controller.handle({ type: "getSettings" }, { trusted: true }))
        .apiKey,
    ).toBe("test-only-key");
    expect((await controller.handle({ type: "testKey", key: "x" })).error).toBe(
      "forbidden",
    );
  });
  it("coalesces forced and normal reads, then reuses a fresh cache", async () => {
    const pending = deferred();
    const f = vi.fn(() => pending.promise);
    const { controller } = setup(f);
    const a = controller.handle({ type: "book" });
    const b = controller.handle({ type: "book", force: true });
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    pending.resolve(response());
    const [ar, br] = await Promise.all([a, b]);
    expect(ar).toEqual(br);
    expect(ar.book.bids).toEqual([{ price: 0.2, quantity: 2000 }]);
    await controller.handle({ type: "book" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("drops an old response after a key change and clears account caches", async () => {
    const pending = deferred();
    const f = vi.fn(() => pending.promise);
    const { controller, storage } = setup(f);
    const read = controller.handle({ type: "book" });
    await vi.waitFor(() => expect(f).toHaveBeenCalledOnce());
    await controller.handle(
      { type: "saveSettings", settings: { apiKey: "new-test-key" } },
      { trusted: true },
    );
    pending.resolve(response());
    expect((await read).error).toBe("superseded");
    expect(storage.data.book).toBeUndefined();
    expect(storage.data.settings.authRevision).toBe(1);
  });
  it("retains caches and auth revision for display-only settings", async () => {
    const { controller, storage } = setup();
    await controller.handle({ type: "book" });
    const before = structuredClone(storage.data.book);
    const r = await controller.handle({
      type: "saveSettings",
      settings: { panel: "market" },
    });
    expect(storage.data.book).toEqual(before);
    expect(r.authRevision).toBe(0);
  });
  it("keeps rejection sticky across worker restarts until the key is explicitly saved", async () => {
    const f = vi.fn(async () => response(bookData, { limit: 100 }));
    const { controller, storage, session } = setup(f);
    expect((await controller.handle({ type: "book" })).error).toBe(
      "key-rejected",
    );
    const restarted = createController({
      storage,
      session,
      fetchImpl: f,
      now: () => NOW + 100000,
      random: () => 0,
    });
    expect((await restarted.handle({ type: "getSettings" })).rejected).toBe(
      true,
    );
    expect((await restarted.handle({ type: "cases", force: true })).error).toBe(
      "key-rejected",
    );
    expect(f).toHaveBeenCalledTimes(1);
    await restarted.handle(
      { type: "saveSettings", settings: { apiKey: "test-only-key" } },
      { trusted: true },
    );
    expect((await restarted.handle({ type: "getSettings" })).rejected).toBe(
      false,
    );
  });
  it("honors 429 globally and after a service-worker restart", async () => {
    const f = vi.fn(async () => response({}, { status: 429 }));
    const { controller, storage, session, advance } = setup(f);
    await controller.handle({ type: "book" });
    advance(30000);
    expect(
      (await controller.handle({ type: "sales", itemCode: "jet", force: true }))
        .error,
    ).toBe("rate-limited");
    const next = createController({
      storage,
      session,
      fetchImpl: f,
      now: () => NOW + 60000,
    });
    await next.handle({ type: "cases", force: true });
    expect(f).toHaveBeenCalledTimes(1);
    expect(session.data.apiHoldUntil).toBe(NOW + 120000);
  });
  it("backs off a failing resource while preserving the last good quote", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockRejectedValue(new Error("offline"));
    const { controller, storage, advance } = setup(f);
    await controller.handle({ type: "book" });
    const at = storage.data.book.at;
    advance(31000);
    expect((await controller.handle({ type: "book" })).error).toBe("network");
    expect(
      (await controller.handle({ type: "book", force: true })).book.at,
    ).toBe(at);
    expect(f).toHaveBeenCalledTimes(2);
    advance(5100);
    await controller.handle({ type: "book" });
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("retains failed average items and their timestamps without declaring a successful refresh", async () => {
    const at = new Date(NOW - 700000).toISOString();
    const f = vi.fn(async (url) => {
      const input = JSON.parse(new URL(url).searchParams.get("input"));
      return response(
        Object.values(input).map((i) =>
          i.itemCode === "jet"
            ? { error: { message: "failed slot" } }
            : { result: { data: 10 } },
        ),
        { batch: true },
      );
    });
    const { controller, storage } = setup(f, {
      avg: {
        cacheVersion: CACHE_VERSION,
        at,
        values: { jet: 900 },
        times: { jet: at },
      },
    });
    const r = await controller.handle({ type: "avg" });
    expect(r.error).toBe("partial");
    expect(r.avg.values.jet).toBe(900);
    expect(r.avg.times.jet).toBe(at);
    expect(r.avg.at).toBe(at);
    expect(r.avg.values.knife).toBe(10);
    expect(r.avg.times.knife).toBe(new Date(NOW).toISOString());
    expect(storage.data.avg).toEqual(r.avg);
    const calls = f.mock.calls.length;
    await controller.handle({ type: "avg", force: true });
    expect(f).toHaveBeenCalledTimes(calls);
  });
  it("redacts keys echoed in API errors before sending them to the page", async () => {
    const f = vi.fn(async () => ({
      ...response(),
      json: async () => ({ error: { message: "bad test-only-key" } }),
    }));
    const { controller } = setup(f);
    const r = await controller.handle({ type: "book" });
    expect(JSON.stringify(r)).not.toContain("test-only-key");
    expect(r.message).toContain("[redacted]");
  });
  it("migrates preferences but drops old-schema and unbounded cache entries", async () => {
    const { controller, storage } = setup(undefined, {
      settings: { apiKey: "test-only-key", panel: "market", minMarginPct: -5 },
      book: { at: new Date(NOW).toISOString() },
      "sales:unknown": {
        cacheVersion: CACHE_VERSION,
        at: new Date(NOW).toISOString(),
      },
    });
    await controller.cleanup();
    expect(storage.data.settings.panel).toBe("market");
    expect(storage.data.settings.minMarginPct).toBe(-5);
    expect(storage.data.book).toBeUndefined();
    expect(storage.data["sales:unknown"]).toBeUndefined();
    expect(
      (await controller.handle({ type: "sales", itemCode: "../../settings" }))
        .error,
    ).toBe("bad-item");
  });
  it("keeps the player's own feed as a store: a 7-day backfill, then polls that stop at a known row, kept across key changes", async () => {
    const ME = "697b55e4bcecf3b37667e0d1";
    const oid = (n) => n.toString(16).padStart(24, "0");
    const craftRow = (n, hoursAgo) => ({
      _id: oid(n),
      itemCode: "scraps",
      quantity: 486,
      sellerId: ME,
      buyerId: ME,
      transactionType: "craftItem",
      item: {
        _id: oid(1000 + n),
        code: "boots5",
        skills: { dodge: 38 },
        state: 100,
      },
      createdAt: new Date(NOW - hoursAgo * 3600e3).toISOString(),
    });
    let crafts = [craftRow(1, 1), craftRow(2, 2)];
    const calls = [];
    const f = vi.fn(async (url) => {
      const u = new URL(url);
      const input = JSON.parse(u.searchParams.get("input"));
      const proc = u.pathname.split("/").pop();
      if (proc === "transaction.getPaginatedTransactions") {
        calls.push(input.transactionType);
        return response({
          items: input.transactionType === "craftItem" ? crafts : [],
          nextCursor: null,
        });
      }
      if (proc === "itemTrading.getItemTrading")
        return response({
          itemCode: input.itemCode,
          values: [
            {
              valueAt: "2026-09-16",
              avgValue: input.itemCode === "scraps" ? 0.25 : 1.8,
            },
          ],
        });
      if (proc === "user.getUserLite")
        return response({ _id: ME, username: "Johnny_Sins" });
      return response();
    });
    const { controller, storage, advance } = setup(f);
    expect(
      (await controller.handle({ type: "feed", userId: "nope" })).error,
    ).toBe("bad-user");
    expect(
      (await controller.handle({ type: "feed", userId: "../settings" })).error,
    ).toBe("bad-user");
    const r = await controller.handle({ type: "feed", userId: ME });
    expect(r.error).toBeUndefined();
    expect(r.feed).toMatchObject({
      userId: ME,
      username: "Johnny_Sins",
      feedVersion: 1,
      holes: { crafts: false, sales: false, dismantles: false },
      averages: {
        scraps: { "2026-09-16": 0.25 },
        steel: { "2026-09-16": 1.8 },
      },
    });
    expect(r.feed.rows.crafts.map((c) => c.txId)).toEqual([oid(1), oid(2)]);
    expect(r.feed.rows.crafts[0]).toMatchObject({
      id: oid(1001),
      code: "boots5",
      skills: { dodge: 38 },
      scraps: 486,
    });
    expect(r.feed.covered.crafts).toBe(
      new Date(NOW - 7 * 86400e3).toISOString(),
    );
    expect(storage.data[`feed:${ME}`].feedVersion).toBe(1);
    expect(calls).toEqual(["craftItem", "itemMarket", "dismantleItem"]);
    // fresh for a minute: reused without a call
    const before = f.mock.calls.length;
    await controller.handle({ type: "feed", userId: ME });
    expect(f.mock.calls.length).toBe(before);
    // a minute later a new craft is on top of the feed: the poll stops at the known row and keeps both
    advance(61_000);
    crafts = [craftRow(3, 0.5), ...crafts];
    const polled = await controller.handle({ type: "feed", userId: ME });
    expect(polled.feed.rows.crafts.map((c) => c.txId)).toEqual([
      oid(3),
      oid(1),
      oid(2),
    ]);
    expect(polled.feed.covered.crafts).toBe(r.feed.covered.crafts);
    expect(
      f.mock.calls.filter(([u]) => u.includes("getItemTrading")).length,
    ).toBe(2); // averages not asked again within ten minutes
    expect(f.mock.calls.filter(([u]) => u.includes("getUserLite")).length).toBe(
      1,
    );
    // the store is the player's record: a new key keeps it, while the account caches go
    await controller.handle(
      { type: "saveSettings", settings: { apiKey: "another-key" } },
      { trusted: true },
    );
    expect(storage.data[`feed:${ME}`].rows.crafts).toHaveLength(3);
    await controller.cleanup();
    expect(storage.data[`feed:${ME}`]).toBeDefined();
    // a store older than the window is dropped by cleanup
    storage.data[`feed:${ME}`].at = new Date(NOW - 31 * 86400e3).toISOString();
    await controller.cleanup();
    expect(storage.data[`feed:${ME}`]).toBeUndefined();
  });
  it("reports a backfill that hit its page cap as a hole, with the coverage at its oldest row", async () => {
    const ME = "697b55e4bcecf3b37667e0d1";
    const oid = (n) => n.toString(16).padStart(24, "0");
    const rows = Array.from({ length: 2600 }, (_, i) => ({
      _id: oid(i + 1),
      money: 4,
      itemCode: "gun",
      quantity: 1,
      sellerId: ME,
      buyerId: oid(99),
      transactionType: "itemMarket",
      item: {
        _id: oid(5000 + i),
        code: "gun",
        skills: { attack: 54, criticalChance: 8 },
        state: 100,
      },
      createdAt: new Date(NOW - i * 240e3).toISOString(), // one every four minutes: 2,520 rows in 7 days, past the 2,500-row cap
    }));
    const f = vi.fn(async (url) => {
      const u = new URL(url);
      const input = JSON.parse(u.searchParams.get("input"));
      const proc = u.pathname.split("/").pop();
      if (proc === "transaction.getPaginatedTransactions") {
        if (input.transactionType !== "itemMarket")
          return response({ items: [], nextCursor: null });
        const page = input.cursor ? Number(input.cursor.slice(1)) : 0;
        return response({
          items: rows.slice(page * 100, page * 100 + 100),
          nextCursor: `p${page + 1}`,
        });
      }
      if (proc === "itemTrading.getItemTrading")
        return response({ itemCode: input.itemCode, values: [] });
      if (proc === "user.getUserLite")
        return response({ _id: ME, username: "x" });
      return response();
    });
    const { controller } = setup(f);
    const r = await controller.handle({ type: "feed", userId: ME });
    expect(r.feed.rows.sales).toHaveLength(2500);
    expect(r.feed.holes).toEqual({
      crafts: false,
      sales: true,
      dismantles: false,
    });
    expect(r.feed.covered.sales).toBe(rows[2499].createdAt);
  });
});
