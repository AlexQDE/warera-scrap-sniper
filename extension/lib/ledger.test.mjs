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
    });
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
  it("refuses a sale without proceeds, any move after a sale, and unknown moves", () => {
    expect(
      transition(crafted, { type: "sell", proceeds: null }, NOW),
    ).toBeNull();
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
  it("skips malformed entries, rejects what is not a ledger, and bounds the list", () => {
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
    const bounded = importLedger(JSON.stringify(many), []);
    expect(bounded.entries).toHaveLength(MAX_ENTRIES);
    expect(bounded.entries[0].id).toBe(
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
  it("keeps both tabs' new entries, lets the newer edit win, honours removals and remembers them", () => {
    const edited = {
      ...base,
      label: "edited later",
      updatedAt: new Date(NOW + 5000).toISOString(),
    };
    const stale = {
      ...base,
      label: "stale copy",
      updatedAt: new Date(NOW + 1000).toISOString(),
    };
    const m = mergeLedgers({
      stored: [edited, other],
      incoming: [
        stale,
        { ...other, id: "test-0003", label: "tab B's new one" },
      ],
      removed: ["test-0002"],
      now: NOW + 9000,
    });
    expect(m.entries.map((e) => e.id).sort()).toEqual([
      "test-0001",
      "test-0003",
    ]);
    expect(m.entries.find((e) => e.id === "test-0001").label).toBe(
      "edited later",
    );
    expect(m.tombstones["test-0002"]).toBe(new Date(NOW + 9000).toISOString());
  });
  it("does not let a stale copy bring back an entry deleted elsewhere, unless it was edited after the deletion", () => {
    const tombstones = { "test-0002": new Date(NOW + 5000).toISOString() };
    const stale = { ...other, updatedAt: new Date(NOW + 1000).toISOString() };
    expect(
      mergeLedgers({
        stored: [base],
        incoming: [base, stale],
        tombstones,
      }).entries.map((e) => e.id),
    ).toEqual(["test-0001"]);
    const revived = { ...other, updatedAt: new Date(NOW + 6000).toISOString() };
    expect(
      mergeLedgers({ stored: [base], incoming: [base, revived], tombstones })
        .entries,
    ).toHaveLength(2);
  });
  it("normalizes a stored ledger with its revision and tombstones, bounded", () => {
    const l = normalizeLedger(
      {
        revision: 3,
        entries: [base],
        tombstones: {
          "test-0009": new Date(NOW).toISOString(),
          bad: "x",
          "test-0008": "junk",
        },
      },
      NOW,
    );
    expect(l.revision).toBe(3);
    expect(Object.keys(l.tombstones)).toEqual(["test-0009"]);
    expect(normalizeLedger({ revision: -1 }).revision).toBe(0);
    const many = Object.fromEntries(
      Array.from({ length: MAX_TOMBSTONES + 5 }, (_, i) => [
        `dead-${String(i).padStart(4, "0")}`,
        new Date(NOW + i * 1000).toISOString(),
      ]),
    );
    expect(Object.keys(normalizeTombstones(many))).toHaveLength(MAX_TOMBSTONES);
  });
});
