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
    // a deletion on the current revision: remembered with the revision it made
    const third = await write([], 2, ["tab-a-001"]);
    expect(third.ledger.entries.map((e) => e.id)).toEqual(["tab-b-001"]);
    expect(third.ledger.tombstones["tab-a-001"]).toEqual({
      at: new Date(NOW).toISOString(),
      revision: 3,
    });
    // a tab that last read revision 1 lists its copy of the deleted entry, stamped later than the deletion: it stays deleted and the tab is told
    const late = {
      ...entry("tab-a-001", "listed from a stale tab"),
      updatedAt: new Date(NOW + 60_000).toISOString(),
    };
    const fourth = await write([late, entry("tab-b-001")], 1);
    expect(fourth.merged).toBe(true);
    expect(fourth.ledger.entries.map((e) => e.id)).toEqual(["tab-b-001"]);
    expect(fourth.dropped).toEqual(["tab-a-001"]);
    // without a base it is no better off; an untouched stale copy is never sent anyway, only changes travel
    const fifth = await write([late]);
    expect(fifth.ledger.entries.map((e) => e.id)).toEqual(["tab-b-001"]);
    expect(fifth.dropped).toEqual(["tab-a-001"]);
    // a tab that read the deletion (revision 5 now) and sends the id again did so on purpose: an import brings it back
    const sixth = await write([entry("tab-a-001", "imported back")], 5);
    expect(sixth.dropped).toEqual([]);
    expect(sixth.ledger.entries.map((e) => e.id).sort()).toEqual([
      "tab-a-001",
      "tab-b-001",
    ]);
    expect(
      (await controller.handle({ type: "ledgerGet" })).ledger.revision,
    ).toBe(6); // six writes, whatever they carried
  });
  it("keeps a sale recorded by one tab against the other tab's later move or deletion of its stale copy, and reports the conflict", async () => {
    const { controller } = setup();
    const iso = (ms) => new Date(NOW + ms).toISOString();
    const crafted = {
      id: "shared-001",
      createdAt: iso(0),
      updatedAt: iso(0),
      code: "boots5",
      inputs: { scraps: 1, steel: 0, scrapPrice: 0.2 },
      state: "crafted",
    };
    const write = (changed, baseRevision, removed = []) =>
      controller.handle({ type: "ledgerSet", changed, baseRevision, removed });
    const first = await write([crafted], 0); // revision 1, read by both tabs
    expect(first.ledger.entries[0].revision).toBe(1);
    // tab A records the sale
    const sold = {
      ...crafted,
      state: "sold",
      sale: { proceeds: 3, at: iso(1000) },
      updatedAt: iso(1000),
    };
    const second = await write([sold], 1); // revision 2
    expect(second.conflicts).toEqual([]);
    expect(second.ledger.entries[0]).toMatchObject({
      state: "sold",
      revision: 2,
    });
    // tab B, still on revision 1, marks its crafted copy kept, stamped later: the sale stays and B is told
    const kept = { ...crafted, state: "kept", updatedAt: iso(2000) };
    const third = await write([kept], 1); // revision 3
    expect(third.conflicts).toEqual(["shared-001"]);
    expect(third.dropped).toEqual([]);
    expect(third.ledger.entries[0]).toMatchObject({
      state: "sold",
      sale: { proceeds: 3 },
      revision: 2,
    });
    // B's deletion of that stale copy is refused the same way, nothing is tombstoned
    const fourth = await write([], 1, ["shared-001"]); // revision 4
    expect(fourth.conflicts).toEqual(["shared-001"]);
    expect(fourth.ledger.entries).toHaveLength(1);
    expect(fourth.ledger.tombstones).toEqual({});
    // once B has read the sale (revision 4 now), its deletion goes through
    const fifth = await write([], 4, ["shared-001"]); // revision 5
    expect(fifth.conflicts).toEqual([]);
    expect(fifth.ledger.entries).toEqual([]);
    expect(fifth.ledger.tombstones["shared-001"]).toMatchObject({
      revision: 5,
    });
  });
  it("merges two tabs' recipe saves instead of letting the second replace the first, and still lets the popup clear the table", async () => {
    const { controller } = setup();
    const a = await controller.handle({
      type: "saveSettings",
      settings: {
        craftRecipeOps: { set: { boots5: { scraps: 10, steel: 2 } } },
      },
    });
    expect(a.settings.craftRecipes).toEqual({
      boots5: { scraps: 10, steel: 2 },
    });
    // the other tab still holds the empty table it read before, and saves a different code
    const b = await controller.handle({
      type: "saveSettings",
      settings: { craftRecipeOps: { set: { jet: { scraps: 30, steel: 3 } } } },
    });
    expect(b.settings.craftRecipes).toEqual({
      boots5: { scraps: 10, steel: 2 },
      jet: { scraps: 30, steel: 3 },
    });
    const c = await controller.handle({
      type: "saveSettings",
      settings: { craftRecipeOps: { remove: ["boots5"] } },
    });
    expect(c.settings.craftRecipes).toEqual({ jet: { scraps: 30, steel: 3 } });
    const cleared = await controller.handle(
      { type: "saveSettings", settings: { craftRecipes: {} } },
      { trusted: true },
    );
    expect(cleared.settings.craftRecipes).toEqual({});
  });
});
