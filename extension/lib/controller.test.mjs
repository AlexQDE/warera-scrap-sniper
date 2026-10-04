import { describe, it, expect, vi } from "vitest";
import { createController, LEDGER_BYTES } from "./controller.mjs";
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
      settings: { collapsed: false },
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
      settings: { apiKey: "test-only-key", collapsed: false, minMarginPct: -5 },
      book: { at: new Date(NOW).toISOString() },
      "sales:unknown": {
        cacheVersion: CACHE_VERSION,
        at: new Date(NOW).toISOString(),
      },
    });
    await controller.cleanup();
    expect(storage.data.settings.collapsed).toBe(false);
    expect(storage.data.settings.minMarginPct).toBe(-5);
    expect(storage.data.book).toBeUndefined();
    expect(storage.data["sales:unknown"]).toBeUndefined();
    expect(
      (await controller.handle({ type: "sales", itemCode: "../../settings" }))
        .error,
    ).toBe("bad-item");
  });
  it("stores a validated, bounded craft ledger for the page and keeps it across key changes and cleanup", async () => {
    const { controller, storage } = setup();
    expect(
      (await controller.handle({ type: "ledgerGet" })).ledger,
    ).toMatchObject({ version: 1, revision: 0, entries: [] });
    const entry = {
      id: "test-0001",
      createdAt: new Date(NOW).toISOString(),
      code: "boots5",
      inputs: { scraps: 10, steel: 2, scrapPrice: 0.2, steelPrice: 1.5 },
      state: "crafted",
    };
    const saved = await controller.handle({
      type: "ledgerSet",
      changed: [entry, { id: "bad" }, "junk"],
      baseRevision: 0,
    });
    expect(saved.ledger.entries).toHaveLength(1);
    expect(saved.ledger.entries[0].costBasis).toBe(5);
    expect(storage.data.craftLedger.entries[0].id).toBe("test-0001");
    expect(JSON.stringify(storage.data.craftLedger)).not.toContain("junk");
    await controller.handle(
      { type: "saveSettings", settings: { apiKey: "another-key" } },
      { trusted: true },
    );
    await controller.cleanup();
    expect(
      (await controller.handle({ type: "ledgerGet" })).ledger.entries,
    ).toHaveLength(1);
    const huge = {
      entries: Array.from({ length: 502 }, (_, i) => ({
        ...entry,
        createdAt: new Date(NOW + 1000).toISOString(), // newer than the first entry, so they sort first
        id: `huge-${i}`,
        notes: "n".repeat(500),
        label: "l".repeat(500),
        result: { note: "x".repeat(500) },
      })),
    };
    const bounded = await controller.handle({
      type: "ledgerSet",
      changed: huge.entries,
      baseRevision: saved.ledger.revision,
    });
    expect(bounded.error).toBeUndefined();
    expect(bounded.ledger.entries).toHaveLength(500);
    expect(bounded.ledger.entries[0].notes).toHaveLength(200);
    expect(JSON.stringify(storage.data.craftLedger).length).toBeLessThan(
      LEDGER_BYTES,
    );
  });
  it("merges a stale tab's ledger write instead of replacing the other tab's entries, and keeps deletions deleted", async () => {
    const { controller } = setup();
    const entry = (id, label = "") => ({
      id,
      createdAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
      label,
      code: "boots5",
      inputs: { scraps: 1, steel: 0, scrapPrice: 0.2 },
      state: "crafted",
    });
    const write = (changed, baseRevision, removed = []) =>
      controller.handle({ type: "ledgerSet", changed, baseRevision, removed });
    const first = await write([entry("tab-a-001")], 0);
    expect(first.ledger.revision).toBe(1);
    expect(first.merged).toBe(false);
    // tab B read revision 0 before tab A wrote, and now sends its own entry only
    const second = await write([entry("tab-b-001")], 0);
    expect(second.merged).toBe(true);
    expect(second.ledger.revision).toBe(2);
    expect(second.ledger.entries.map((e) => e.id).sort()).toEqual([
      "tab-a-001",
      "tab-b-001",
    ]);
    // a deletion on the current revision, then a stale edit of the deleted entry and of the other one
    const third = await write([], 2, ["tab-a-001"]);
    expect(third.ledger.entries.map((e) => e.id)).toEqual(["tab-b-001"]);
    const fourth = await write([entry("tab-a-001"), entry("tab-b-001")], 1);
    expect(fourth.merged).toBe(true);
    expect(fourth.ledger.entries.map((e) => e.id)).toEqual(["tab-b-001"]);
    // an untouched stale copy is never sent, so it can neither overwrite nor revive: only changes travel
    const fifth = await write([], 0);
    expect(fifth.ledger.entries.map((e) => e.id)).toEqual(["tab-b-001"]);
    expect(
      (await controller.handle({ type: "ledgerGet" })).ledger.revision,
    ).toBe(5); // five writes, whatever they carried
  });
});
