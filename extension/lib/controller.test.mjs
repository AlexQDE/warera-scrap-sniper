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
  const ME = "697b55e4bcecf3b37667e0d1";
  const OTHER = "69b4b8113af735a990a8070e";
  const oid = (n) => n.toString(16).padStart(24, "0");
  /** A fake history API: `rows` newest first, pages of 100, cursor "p<n>"; plus prices and the player's card. */
  function historyApi(rowsRef) {
    const calls = [];
    const f = vi.fn(async (url) => {
      const u = new URL(url);
      const input = JSON.parse(u.searchParams.get("input"));
      const proc = u.pathname.split("/").pop();
      if (proc === "transaction.getPaginatedTransactions") {
        const page = input.cursor ? Number(input.cursor.slice(1)) : 0;
        calls.push(page);
        const rows = rowsRef.rows;
        return response({
          items: rows.slice(page * 100, page * 100 + 100),
          nextCursor: rows.length > (page + 1) * 100 ? `p${page + 1}` : null,
        });
      }
      if (proc === "itemTrading.getItemTrading")
        return response({
          itemCode: input.itemCode,
          values: [
            {
              valueAt: "2026-09-16",
              avgValue:
                { scraps: 0.25, steel: 1.8, case1: 3.8 }[input.itemCode] ?? 1,
            },
          ],
        });
      if (proc === "user.getUserLite")
        return response({ _id: ME, username: "Johnny_Sins" });
      return response();
    });
    return { f, calls };
  }
  const openRow = (n, minutesAgo) => ({
    _id: oid(n),
    itemCode: "case1",
    quantity: 1,
    sellerId: ME,
    buyerId: ME,
    transactionType: "openCase",
    item: {
      _id: oid(100000 + n),
      code: "knife",
      skills: { attack: 30, criticalChance: 3 },
      state: 100,
    },
    createdAt: new Date(NOW - minutesAgo * 60e3).toISOString(),
  });
  it("fills the player's history from the start of the profile in steps, by month, and keeps it across key changes and cleanup", async () => {
    // 1,050 openings, one every 90 minutes: 11 pages reaching back about 65 days, across three months
    const ref = {
      rows: Array.from({ length: 1050 }, (_, i) => openRow(i + 1, i * 90)),
    };
    const { f, calls } = historyApi(ref);
    const { controller, storage } = setup(f, { "feed:old": { at: "x" } });
    expect(
      (await controller.handle({ type: "history", userId: "nope" })).error,
    ).toBe("bad-user");
    const first = await controller.handle({ type: "history", userId: ME });
    expect(first.error).toBeUndefined();
    expect(first.history).toMatchObject({
      userId: ME,
      username: "Johnny_Sins",
      done: false,
      pages: 8,
      count: 800,
    });
    expect(calls).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const months = Object.keys(storage.data).filter((k) =>
      k.startsWith(`hist:${ME}:2026`),
    );
    expect(months.length).toBeGreaterThanOrEqual(2);
    // the next step goes on from where the last stopped, without a poll (not due yet)
    const second = await controller.handle({ type: "history", userId: ME });
    expect(second.history).toMatchObject({
      done: true,
      pages: 11,
      count: 1050,
    });
    expect(calls.slice(8)).toEqual([8, 9, 10]);
    expect(second.history.oldestAt).toBe(ref.rows.at(-1).createdAt);
    // nothing is due now: no call
    await controller.handle({ type: "history", userId: ME });
    expect(calls).toHaveLength(11);
    // a key change keeps the history; cleanup keeps it and drops the 2.2 feed store
    await controller.handle(
      { type: "saveSettings", settings: { apiKey: "another-key" } },
      { trusted: true },
    );
    await controller.cleanup();
    expect(storage.data[`hist:${ME}:meta`].count).toBe(1050);
    expect(storage.data["feed:old"]).toBeUndefined();
  });
  it("polls from the top and stops at the first row it holds, every minute, every 15 seconds while a dialog is open", async () => {
    const ref = {
      rows: Array.from({ length: 150 }, (_, i) => openRow(i + 1, i * 10)),
    };
    const { f, calls } = historyApi(ref);
    const { controller, advance } = setup(f);
    await controller.handle({ type: "history", userId: ME });
    expect(calls).toEqual([0, 1]);
    // two new openings on top
    ref.rows = [openRow(9002, -0.2), openRow(9001, -0.1), ...ref.rows]; // 12 s and 6 s after the first read
    advance(16_000);
    await controller.handle({ type: "history", userId: ME });
    expect(calls).toHaveLength(2); // a minute has not passed
    const fast = await controller.handle({
      type: "history",
      userId: ME,
      fast: true,
    });
    expect(calls).toEqual([0, 1, 0]);
    expect(fast.history.count).toBe(152);
    advance(61_000);
    const again = await controller.handle({ type: "history", userId: ME });
    expect(again.history.count).toBe(152); // the top page holds nothing new
    expect(calls).toEqual([0, 1, 0, 0]);
    const forced = await controller.handle({
      type: "history",
      userId: ME,
      force: true,
    });
    expect(forced.history.count).toBe(152);
    expect(calls).toHaveLength(5);
  });
  it("views the history in the worker: results by activity and window, the last opening, the codes to price", async () => {
    const sale = {
      _id: oid(5),
      money: 2,
      itemCode: "knife",
      quantity: 1,
      sellerId: ME,
      buyerId: OTHER,
      transactionType: "itemMarket",
      item: {
        _id: oid(100001),
        code: "knife",
        skills: { attack: 30, criticalChance: 3 },
        state: 100,
      },
      createdAt: new Date(NOW - 30e3).toISOString(),
    };
    const ref = { rows: [sale, openRow(2, 1), openRow(1, 2)] };
    const { f } = historyApi(ref);
    const { controller, storage } = setup(f);
    await controller.handle({ type: "history", userId: ME });
    // the knives' sales were read by a page: the held one is valued at the sales of its stats
    storage.data["sales:knife"] = {
      code: "knife",
      at: new Date(NOW).toISOString(),
      complete: true,
      cacheVersion: CACHE_VERSION,
      fills: [1.5, 1.5, 1.5].map((price, i) => ({
        price,
        at: new Date(NOW - (i + 1) * 3600e3).toISOString(),
        code: "knife",
        skills: { attack: 30, criticalChance: 3 },
      })),
    };
    const v = (await controller.handle({ type: "ledger", userId: ME })).ledger;
    expect(v.meta).toMatchObject({ userId: ME, done: true, count: 3 });
    const all = v.windows.all;
    expect(all.opened).toMatchObject({ n: 2, sold: 1, held: 1, heldPriced: 1 });
    // each case cost 3.8 (the day on record, approximate): one sold for 2, one held at 1.5
    expect(all.opened.estimated).toBeCloseTo(2 - 3.8 + 1.5 - 3.8, 6);
    expect(all.cases.case1.n).toBe(2);
    expect(v.lastOpened).toMatchObject({
      via: "case1",
      code: "knife",
      fate: "held",
    });
    expect(v.lastOpened.value).toMatchObject({ value: 1.5 });
    expect(v.salesWanted).toEqual(["knife"]);
    expect(v.rows.length).toBeGreaterThan(0);
  });
  it("lists today's crafts with what each sells for, and leaves gear worn in battle out in eco mode", async () => {
    const tank = (n) => ({
      _id: oid(100100 + n),
      code: "tank",
      skills: { attack: 150 + n, criticalChance: 30 },
      state: 100,
    });
    const at = (minutesAgo) => new Date(NOW - minutesAgo * 60e3).toISOString();
    const craft = (n, minutesAgo) => ({
      _id: oid(n),
      itemCode: "scraps",
      quantity: 486,
      sellerId: ME,
      buyerId: ME,
      transactionType: "craftItem",
      item: tank(n),
      createdAt: at(minutesAgo),
    });
    const ref = {
      rows: [
        // the first tank was worn in battle and scrapped for a third of its scraps
        {
          _id: oid(3),
          itemCode: "scraps",
          quantity: 162,
          sellerId: ME,
          buyerId: ME,
          transactionType: "dismantleItem",
          item: tank(1),
          createdAt: at(2),
        },
        craft(2, 4),
        craft(1, 6),
      ],
    };
    const { f } = historyApi(ref);
    const { controller, storage } = setup(f);
    await controller.handle({ type: "history", userId: ME });
    storage.data["sales:tank"] = {
      code: "tank",
      at: new Date(NOW).toISOString(),
      complete: true,
      cacheVersion: CACHE_VERSION,
      fills: [140, 141, 142].map((price, i) => ({
        price,
        at: new Date(NOW - (i + 1) * 3600e3).toISOString(),
        code: "tank",
        skills: { attack: 152, criticalChance: 30 },
      })),
    };
    const eco = (await controller.handle({ type: "ledger", userId: ME }))
      .ledger;
    expect(eco.mode).toBe("eco");
    expect(eco.windows.all.tiers.legendary).toMatchObject({ n: 1, worn: 1 });
    expect(eco.craftsToday.map((p) => [p.code, p.worn, p.fate])).toEqual([
      ["tank", false, "held"],
      ["tank", true, "scrapped"],
    ]);
    expect(eco.craftsToday[0].value).toMatchObject({ value: 141 });
    expect(eco.salesWanted[0]).toBe("tank");
    await controller.handle(
      { type: "saveSettings", settings: { ledgerMode: "war" } },
      { trusted: true },
    );
    const war = (await controller.handle({ type: "ledger", userId: ME }))
      .ledger;
    expect(war.mode).toBe("war");
    expect(war.windows.all.tiers.legendary).toMatchObject({ n: 2, worn: 1 });
  });
});
