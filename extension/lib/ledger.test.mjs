import { describe, it, expect } from "vitest";
import {
  MAX_ENTRIES,
  LEDGER_VERSION,
  newId,
  costBasis,
  normalizeEntry,
  createEntry,
  transition,
  summarize,
  exportLedger,
  importLedger,
  normalizeLedger,
  normalizeTombstones,
  mergeLedgers,
  MAX_TOMBSTONES,
} from "./ledger.mjs";

const NOW = Date.parse("2026-10-03T12:00:00.000Z");
const form = {
  code: "boots5",
  label: "legendary boots",
  scraps: 10,
  steel: 2,
  scrapPrice: 0.2,
  steelPrice: 1.5,
  priceSource: "inferred",
  rarity: "legendary",
  stat: 270,
  durability: 100,
  note: "first try",
};

describe("ids and cost basis", () => {
  it("makes short safe ids and prices the inputs only when both used prices are known", () => {
    expect(newId(NOW, () => 0.5)).toMatch(/^c[a-z0-9]{6,20}$/);
    expect(
      costBasis({
        scraps: 10,
        steel: 2,
        scrapPrice: 0.2,
        steelPrice: 1.5,
        priceSource: "manual",
      }),
    ).toBe(5);
    expect(
      costBasis({
        scraps: 10,
        steel: 2,
        scrapPrice: 0.2,
        steelPrice: null,
        priceSource: "manual",
      }),
    ).toBeNull();
    expect(
      costBasis({
        scraps: 10,
        steel: 0,
        scrapPrice: 0.2,
        steelPrice: null,
        priceSource: "manual",
      }),
    ).toBe(2);
  });
});

describe("normalizeEntry and createEntry", () => {
  it("builds a crafted entry from the form, labelled with its price source", () => {
    const e = createEntry(form, { now: NOW, id: "test-0001" });
    expect(e).toMatchObject({
      id: "test-0001",
      createdAt: new Date(NOW).toISOString(),
      code: "boots5",
      label: "legendary boots",
      inputs: {
        scraps: 10,
        steel: 2,
        scrapPrice: 0.2,
        steelPrice: 1.5,
        priceSource: "inferred",
      },
      costBasis: 5,
      result: {
        rarity: "legendary",
        stat: 270,
        durability: 100,
        note: "first try",
      },
      state: "crafted",
      listing: { price: null, at: null },
      sale: { proceeds: null, at: null, source: "manual" },
      revision: 0, // the worker assigns it when it stores the entry
    });
    expect(normalizeEntry({ ...e, revision: 4 }).revision).toBe(4);
    expect(normalizeEntry({ ...e, revision: "junk" }).revision).toBe(0);
    expect(normalizeEntry({ ...e, revision: -1 }).revision).toBe(0);
    // a listing without its price is not a listing: the piece is still crafted
    const at = new Date(NOW).toISOString();
    expect(
      normalizeEntry({ ...e, state: "listed", listing: { price: null, at } }),
    ).toMatchObject({ state: "crafted", listing: { price: null, at: null } });
    expect(
      normalizeEntry({ ...e, state: "listed", listing: { price: 3, at } }),
    ).toMatchObject({ state: "listed", listing: { price: 3, at } });
  });
  it("drops what it cannot trust: bad ids, negative quantities, a sale without proceeds, unknown codes and states", () => {
    expect(normalizeEntry({ ...form, id: "x" })).toBeNull();
    expect(normalizeEntry({ id: "ok-1", inputs: { scraps: -1 } })).toBeNull();
    expect(
      normalizeEntry({ id: "ok-1", inputs: { scraps: 1 }, state: "sold" }),
    ).toBeNull();
    const loose = normalizeEntry({
      id: "ok-1",
      code: "hat9",
      state: "flying",
      inputs: { scraps: "3", steel: "x" },
    });
    expect(loose).toBeNull();
    const e = normalizeEntry(
      {
        id: "ok-1",
        code: "hat9",
        state: "flying",
        inputs: { scraps: "3" },
        label: "  a   b  ".padEnd(200, "z"),
        listing: { price: 5 },
      },
      NOW,
    );
    expect(e.code).toBeNull();
    expect(e.state).toBe("crafted");
    expect(e.inputs).toEqual({
      scraps: 3,
      steel: 0,
      scrapPrice: null,
      steelPrice: null,
      priceSource: "manual",
    });
    expect(e.label.length).toBe(80);
    expect(e.listing.price).toBeNull(); // a crafted piece is not listed
    expect(e.costBasis).toBeNull();
    expect(normalizeEntry("junk")).toBeNull();
    expect(normalizeEntry([])).toBeNull();
  });
});

describe("transition", () => {
  const crafted = createEntry(form, { now: NOW, id: "test-0001" });
  it("lists, sells, keeps, scraps and unlists, stamping the time", () => {
    const listed = transition(crafted, { type: "list", price: 12 }, NOW + 1000);
    expect(listed.state).toBe("listed");
    expect(listed.listing).toEqual({
      price: 12,
      at: new Date(NOW + 1000).toISOString(),
    });
    const sold = transition(
      listed,
      { type: "sell", proceeds: 11.4 },
      NOW + 2000,
    );
    expect(sold.state).toBe("sold");
    expect(sold.sale).toEqual({
      proceeds: 11.4,
      at: new Date(NOW + 2000).toISOString(),
      source: "manual",
    });
    expect(sold.listing.price).toBe(12);
    expect(transition(crafted, { type: "keep" }, NOW).state).toBe("kept");
    expect(transition(crafted, { type: "scrap" }, NOW).state).toBe("scrapped");
    const back = transition(listed, { type: "unlist" }, NOW);
    expect(back.state).toBe("crafted");
    expect(back.listing.price).toBeNull();
  });
  it("refuses a sale without proceeds, a listing without a price, any move after a sale, and unknown moves", () => {
    expect(
      transition(crafted, { type: "sell", proceeds: null }, NOW),
    ).toBeNull();
    expect(transition(crafted, { type: "list" }, NOW)).toBeNull();
    expect(transition(crafted, { type: "list", price: "" }, NOW)).toBeNull();
    expect(transition(crafted, { type: "list", price: -1 }, NOW)).toBeNull();
    const sold = transition(crafted, { type: "sell", proceeds: 1 }, NOW);
    expect(transition(sold, { type: "list", price: 1 }, NOW)).toBeNull();
    expect(transition(crafted, { type: "teleport" }, NOW)).toBeNull();
  });
});

describe("summarize", () => {
  const base = createEntry(form, { now: NOW, id: "test-0001" });
  const entries = [
    transition(base, { type: "sell", proceeds: 11 }, NOW), // realized +6 on a 5 basis
    transition(
      {
        ...base,
        id: "test-0002",
        inputs: { ...base.inputs, steelPrice: null, priceSource: "manual" },
        costBasis: null,
      },
      { type: "sell", proceeds: 3 },
      NOW,
    ),
    transition({ ...base, id: "test-0003" }, { type: "list", price: 9 }, NOW),
    { ...base, id: "test-0004" },
    transition({ ...base, id: "test-0005" }, { type: "scrap" }, NOW),
  ];
  it("counts realized profit on recorded sales with a known basis only, and estimates the open pieces separately", () => {
    const s = summarize(entries, {
      estimateFor: (code) => (code === "boots5" ? 8 : null),
    });
    expect(s.count).toBe(5);
    expect(s.sold).toEqual({
      n: 2,
      proceeds: 14,
      cost: 5,
      realized: 6,
      unknownCost: 1,
    });
    expect(s.open).toEqual({
      n: 2,
      cost: 10,
      unknownCost: 0,
      estimated: 16,
      covered: 2,
    });
    expect(s.inferred).toBe(4);
    expect(s.manual).toBe(1);
  });
  it("has nothing estimated without an estimate and nothing realized without sales", () => {
    const s = summarize([{ ...base, id: "test-0004" }]);
    expect(s.sold.realized).toBe(0);
    expect(s.open).toEqual({
      n: 1,
      cost: 5,
      unknownCost: 0,
      estimated: 0,
      covered: 0,
    });
  });
});

describe("export and import", () => {
  const a = createEntry(form, { now: NOW, id: "test-000a" });
  const b = createEntry(
    { ...form, label: "second" },
    { now: NOW + 1000, id: "test-000b" },
  );
  it("round-trips a ledger and merges by id with the newer entry winning", () => {
    const file = exportLedger([a, b], NOW);
    const parsed = JSON.parse(file);
    expect(parsed).toMatchObject({
      app: "WarEra Plus",
      kind: "craft-ledger",
      version: LEDGER_VERSION,
    });
    expect(parsed.entries).toHaveLength(2);
    const fresh = importLedger(file, []);
    expect(fresh).toMatchObject({
      added: 2,
      updated: 0,
      skipped: 0,
      error: null,
    });
    expect(fresh.entries.map((e) => e.id)).toEqual(["test-000b", "test-000a"]);
    const soldA = transition(a, { type: "sell", proceeds: 9 }, NOW + 5000);
    const merged = importLedger(
      exportLedger(
        [
          soldA,
          {
            ...b,
            label: "stale copy",
            updatedAt: new Date(NOW - 5000).toISOString(),
          },
        ],
        NOW,
      ),
      [a, b],
    );
    expect(merged).toMatchObject({ added: 0, updated: 1, skipped: 0 });
    expect(merged.entries.find((e) => e.id === "test-000a").state).toBe("sold");
    expect(merged.entries.find((e) => e.id === "test-000b").label).toBe(
      "second",
    );
  });
  it("skips malformed entries, rejects what is not a ledger, and leaves the cap to the worker", () => {
    const mixed = importLedger(
      JSON.stringify({
        kind: "craft-ledger",
        entries: [a, { id: "bad" }, "junk"],
      }),
      [],
    );
    expect(mixed).toMatchObject({ added: 1, skipped: 2, error: null });
    expect(importLedger("{not json", [a]).error).toBe("not JSON");
    expect(importLedger("{not json", [a]).entries).toHaveLength(1);
    expect(
      importLedger(JSON.stringify({ kind: "settings", entries: [] }), []).error,
    ).toBe("not a craft ledger export");
    expect(importLedger(JSON.stringify({ hello: 1 }), []).error).toBe(
      "not a craft ledger export",
    );
    const many = Array.from({ length: MAX_ENTRIES + 2 }, (_, i) => ({
      ...a,
      id: `many-${String(i).padStart(4, "0")}`,
      createdAt: new Date(NOW + i * 1000).toISOString(),
    }));
    const whole = importLedger(JSON.stringify(many), []);
    expect(whole.entries).toHaveLength(MAX_ENTRIES + 2); // nothing is cut here: the worker's cap decides and reports
    expect(whole.added).toBe(MAX_ENTRIES + 2);
    expect(whole.entries[0].id).toBe(
      `many-${String(MAX_ENTRIES + 1).padStart(4, "0")}`,
    ); // newest first
  });
  it("normalizes a stored ledger the same way", () => {
    const l = normalizeLedger({ entries: [b, a, null, { id: "zz" }] }, NOW);
    expect(l.version).toBe(LEDGER_VERSION);
    expect(l.entries.map((e) => e.id)).toEqual(["test-000b", "test-000a"]);
    expect(normalizeLedger(undefined).entries).toEqual([]);
  });
});

describe("merging a second tab's list", () => {
  const base = createEntry(form, { now: NOW, id: "test-0001" });
  const other = createEntry(
    { ...form, label: "from tab A" },
    { now: NOW + 1000, id: "test-0002" },
  );
  it("keeps both tabs' new entries, refuses a stale copy of an entry edited since as a conflict, honours removals and remembers them", () => {
    // tab A edited test-0001 in the write that made revision 2; tab B last read revision 1 and still holds the old copy
    const edited = {
      ...base,
      label: "edited later",
      updatedAt: new Date(NOW + 5000).toISOString(),
      revision: 2,
    };
    const stale = {
      ...base,
      label: "stale copy",
      updatedAt: new Date(NOW + 1000).toISOString(),
    };
    const m = mergeLedgers({
      stored: [edited, { ...other, revision: 1 }],
      incoming: [
        stale,
        { ...other, id: "test-0003", label: "tab B's new one" },
      ],
      removed: ["test-0002"],
      baseRevision: 1,
      revision: 3,
      now: NOW + 9000,
    });
    expect(m.entries.map((e) => e.id).sort()).toEqual([
      "test-0001",
      "test-0003",
    ]);
    expect(m.entries.find((e) => e.id === "test-0001").label).toBe(
      "edited later",
    );
    expect(m.conflicts).toEqual(["test-0001"]);
    expect(m.tombstones["test-0002"]).toEqual({
      at: new Date(NOW + 9000).toISOString(),
      revision: 3,
    });
    expect(m.dropped).toEqual([]);
    expect(m.entries.find((e) => e.id === "test-0003").revision).toBe(3); // stored by this write
  });
  it("keeps an entry changed since the writer read it against the writer's later-stamped edit or deletion, as a conflict", () => {
    // tab A sold it in the write that made revision 6
    const sold = {
      ...transition(base, { type: "sell", proceeds: 9 }, NOW + 5000),
      revision: 6,
    };
    // tab B, which last read revision 5, marks its crafted copy kept later: the clock says nothing about what it knew
    const kept = transition(base, { type: "keep" }, NOW + 7000);
    const m = mergeLedgers({
      stored: [sold],
      incoming: [kept],
      baseRevision: 5,
      revision: 7,
    });
    expect(m.entries).toEqual([sold]);
    expect(m.conflicts).toEqual(["test-0001"]);
    expect(m.dropped).toEqual([]);
    // its deletion of that stale copy is refused the same way, and nothing is remembered as deleted
    const d = mergeLedgers({
      stored: [sold],
      incoming: [],
      removed: ["test-0001"],
      baseRevision: 5,
      revision: 7,
    });
    expect(d.entries).toEqual([sold]);
    expect(d.conflicts).toEqual(["test-0001"]);
    expect(d.tombstones).toEqual({});
    // a tab that read revision 6 saw the sale: its deletion goes through
    const ok = mergeLedgers({
      stored: [sold],
      incoming: [],
      removed: ["test-0001"],
      baseRevision: 6,
      revision: 7,
    });
    expect(ok.entries).toEqual([]);
    expect(ok.conflicts).toEqual([]);
    expect(ok.tombstones["test-0001"]).toMatchObject({ revision: 7 });
    // whatever a client sends as revision, a stored entry carries the revision of the write that stored it
    const n = mergeLedgers({
      stored: [],
      incoming: [{ ...base, revision: 99 }],
      baseRevision: 6,
      revision: 7,
    });
    expect(n.entries[0].revision).toBe(7);
  });
  it("keeps an entry deleted against an edit from a tab that never read the deletion, however late it is stamped, and lets a tab that read it bring the id back on purpose", () => {
    // deleted by the write that made revision 4
    const tombstones = {
      "test-0002": { at: new Date(NOW + 5000).toISOString(), revision: 4 },
    };
    // a tab that last read revision 3 lists its copy later than the deletion: the clock says nothing about what it knew
    const late = { ...other, updatedAt: new Date(NOW + 6000).toISOString() };
    const stale = mergeLedgers({
      stored: [base],
      incoming: [base, late],
      tombstones,
      baseRevision: 3,
      revision: 5,
    });
    expect(stale.entries.map((e) => e.id)).toEqual(["test-0001"]);
    expect(stale.dropped).toEqual(["test-0002"]);
    expect(stale.tombstones).toEqual(tombstones);
    // a tab that read revision 4 saw the entry gone: sending it again is deliberate (an import), whatever its stamp
    const old = { ...other, updatedAt: new Date(NOW + 1000).toISOString() };
    const back = mergeLedgers({
      stored: [base],
      incoming: [base, old],
      tombstones,
      baseRevision: 4,
      revision: 5,
    });
    expect(back.entries.map((e) => e.id).sort()).toEqual([
      "test-0001",
      "test-0002",
    ]);
    expect(back.dropped).toEqual([]);
    // no base, or a base no tab can have read, is no base: the deletion wins
    for (const baseRevision of [undefined, NaN, -1, 5, 99])
      expect(
        mergeLedgers({
          stored: [base],
          incoming: [late],
          tombstones,
          baseRevision,
          revision: 5,
        }).dropped,
      ).toEqual(["test-0002"]);
    // an id removed and sent back in the same write stays removed
    expect(
      mergeLedgers({
        stored: [base, other],
        incoming: [late],
        removed: ["test-0002"],
        baseRevision: 4,
        revision: 5,
      }),
    ).toMatchObject({ dropped: ["test-0002"] });
  });
  it("lets a writer that read the stored copy edit it whatever the clocks say: an entry stamped in the future is still sold", () => {
    const future = {
      ...base,
      updatedAt: new Date(NOW + 86_400e3).toISOString(), // an export from a fast clock
      revision: 3,
    };
    const sold = transition(future, { type: "sell", proceeds: 9 }, NOW + 1000);
    expect(Date.parse(sold.updatedAt)).toBeLessThan(
      Date.parse(future.updatedAt),
    );
    const m = mergeLedgers({
      stored: [future],
      incoming: [sold],
      baseRevision: 3,
      revision: 4,
    });
    expect(m.entries[0]).toMatchObject({
      state: "sold",
      sale: { proceeds: 9 },
      revision: 4,
    });
    expect(m.conflicts).toEqual([]);
  });
  it("takes no new entry into a full ledger, never drops a stored one to make room, reports what it could not hold, and still takes edits and removals", () => {
    const full = Array.from({ length: MAX_ENTRIES }, (_, i) => ({
      ...base,
      id: `full-${String(i).padStart(4, "0")}`,
      createdAt: new Date(NOW + 1000 + i).toISOString(),
      revision: 1,
    }));
    const fresh = { ...base, id: "fresh-0001" }; // created before every stored entry, as after a clock that moved back
    const edit = { ...full[7], label: "edited" };
    const m = mergeLedgers({
      stored: full,
      incoming: [fresh, edit],
      baseRevision: 1,
      revision: 2,
    });
    expect(m.entries).toHaveLength(MAX_ENTRIES);
    expect(m.capped).toEqual(["fresh-0001"]);
    expect(m.entries.find((e) => e.id === "full-0007")).toMatchObject({
      label: "edited",
      revision: 2,
    });
    expect(m.entries.every((e) => e.id.startsWith("full-"))).toBe(true);
    // a removal in the same write makes room
    const n = mergeLedgers({
      stored: full,
      incoming: [fresh],
      removed: ["full-0000"],
      baseRevision: 1,
      revision: 2,
    });
    expect(n.capped).toEqual([]);
    expect(n.entries).toHaveLength(MAX_ENTRIES);
    expect(n.entries.map((e) => e.id)).toContain("fresh-0001");
  });
  it("normalizes a stored ledger with its revision and tombstones, bounded to the newest deletions", () => {
    const at = new Date(NOW).toISOString();
    const l = normalizeLedger(
      {
        revision: 3,
        entries: [base],
        tombstones: {
          "test-0009": { at, revision: 2 },
          bad: { at, revision: 1 },
          "test-0008": "junk",
          "test-0007": at, // the shape before deletions carried a revision
          "test-0006": { at: "junk", revision: 1 },
          "test-0005": { at, revision: -1 },
          "test-0004": { at, revision: 1.5 },
        },
      },
      NOW,
    );
    expect(l.revision).toBe(3);
    expect(l.tombstones).toEqual({ "test-0009": { at, revision: 2 } });
    expect(normalizeLedger({ revision: -1 }).revision).toBe(0);
    const many = Object.fromEntries(
      Array.from({ length: MAX_TOMBSTONES + 5 }, (_, i) => [
        `dead-${String(i).padStart(4, "0")}`,
        { at: new Date(NOW + i * 1000).toISOString(), revision: i + 1 },
      ]),
    );
    const kept = Object.keys(normalizeTombstones(many));
    expect(kept).toHaveLength(MAX_TOMBSTONES);
    expect(kept).toContain(
      `dead-${String(MAX_TOMBSTONES + 4).padStart(4, "0")}`,
    );
    expect(kept).not.toContain("dead-0000");
    expect(MAX_TOMBSTONES).toBeGreaterThanOrEqual(1000);
  });
});
