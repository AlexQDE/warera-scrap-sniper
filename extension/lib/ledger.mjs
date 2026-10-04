// @ts-check
// The personal craft ledger: crafts the player recorded by hand, with what
// the inputs cost, what came out, whether it is listed, and what it finally
// sold for. Pure functions over plain entries; the background worker stores
// the list (bounded), the Craft Desk edits it, export/import move it as JSON.
//
// Honesty rules baked in: a value typed by the player is "manual", one the
// desk filled from the quotes of the moment is "inferred"; only a recorded
// sale is realized profit, an unsold piece is at most an estimate, labelled.
import { RARITIES, ALL_GEAR_CODES } from "./items.mjs";
import { nonNegative as money } from "./quality.mjs";

export const LEDGER_VERSION = 1;
export const MAX_ENTRIES = 500;
/**
 * Ids deleted are remembered so a tab that still edits an old copy of one
 * cannot bring it back. Writes carry only what a tab changed (never its whole
 * list), so an untouched stale copy can resurrect nothing; the history only
 * has to outlast a stale edit, and a thousand deletions is far beyond that.
 */
export const MAX_TOMBSTONES = 1000;
export const STATES = Object.freeze([
  "crafted",
  "listed",
  "sold",
  "kept",
  "scrapped",
]);
export const PRICE_SOURCES = Object.freeze(["manual", "inferred"]);

/** @param {unknown} v @param {number} [max] */
const text = (v, max = 120) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
/** @param {unknown} v */
const count = (v) => {
  if (v == null || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};
/** Sums of prices carry float noise (10 × 0.21 + 2 × 1.6); keep nine decimals, well under the 0.001 tick. */
/** @param {number} v */
const exact = (v) => Math.round(v * 1e9) / 1e9;
/** @param {unknown} v */
const when = (v) => {
  if (v == null || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** @param {number} [now] @param {() => number} [random] */
export function newId(now = Date.now(), random = Math.random) {
  return `c${now.toString(36)}${Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, "0")}`;
}

/**
 * @typedef {{ scraps: number, steel: number, scrapPrice: number | null, steelPrice: number | null, priceSource: "manual" | "inferred" }} Inputs
 * @typedef {{ id: string, createdAt: string, updatedAt: string, code: string | null, label: string, inputs: Inputs, costBasis: number | null, result: { rarity: string | null, stat: number | null, durability: number | null, note: string }, state: string, listing: { price: number | null, at: string | null }, sale: { proceeds: number | null, at: string | null, source: "manual" }, notes: string }} Entry
 */

/** The cost of the inputs when both used prices are known; null otherwise, never zero. @param {Inputs} inputs */
export function costBasis(inputs) {
  const scrap =
    inputs.scraps === 0
      ? 0
      : inputs.scrapPrice == null
        ? null
        : inputs.scraps * inputs.scrapPrice;
  const steel =
    inputs.steel === 0
      ? 0
      : inputs.steelPrice == null
        ? null
        : inputs.steel * inputs.steelPrice;
  return scrap == null || steel == null ? null : exact(scrap + steel);
}

/**
 * A well-formed entry from anything (a form, an import, old storage), or
 * null. Unknown fields are dropped, texts bounded, numbers checked.
 * @param {unknown} raw @param {number} [now]
 * @returns {Entry | null}
 */
export function normalizeEntry(raw, now = Date.now()) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = /** @type {Record<string, any>} */ (raw);
  const id = text(r.id, 40);
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return null;
  const scraps = count(r.inputs?.scraps ?? 0);
  const steel = count(r.inputs?.steel ?? 0);
  if (scraps == null || steel == null) return null;
  const priceSource = PRICE_SOURCES.includes(r.inputs?.priceSource)
    ? r.inputs.priceSource
    : "manual";
  const inputs = {
    scraps,
    steel,
    scrapPrice: money(r.inputs?.scrapPrice),
    steelPrice: money(r.inputs?.steelPrice),
    priceSource,
  };
  const createdAt = when(r.createdAt) ?? new Date(now).toISOString();
  const state = STATES.includes(r.state) ? r.state : "crafted";
  const code = ALL_GEAR_CODES.includes(r.code) ? r.code : null;
  const rarity = RARITIES.includes(r.result?.rarity) ? r.result.rarity : null;
  const sale =
    state === "sold"
      ? {
          proceeds: money(r.sale?.proceeds),
          at: when(r.sale?.at),
          source: /** @type {"manual"} */ ("manual"),
        }
      : {
          proceeds: null,
          at: null,
          source: /** @type {"manual"} */ ("manual"),
        };
  if (state === "sold" && sale.proceeds == null) return null; // a sale without proceeds is not a sale
  return {
    id,
    createdAt,
    updatedAt: when(r.updatedAt) ?? createdAt,
    code,
    label: text(r.label, 80),
    inputs,
    costBasis: costBasis(inputs),
    result: {
      rarity,
      stat: count(r.result?.stat),
      durability: count(r.result?.durability),
      note: text(r.result?.note, 120),
    },
    state,
    listing:
      state === "listed" || state === "sold"
        ? { price: money(r.listing?.price), at: when(r.listing?.at) }
        : { price: null, at: null },
    sale,
    notes: text(r.notes, 200),
  };
}

/**
 * A new "crafted" entry from the desk's form.
 * @param {{ code?: unknown, label?: unknown, scraps?: unknown, steel?: unknown, scrapPrice?: unknown, steelPrice?: unknown, priceSource?: unknown, rarity?: unknown, stat?: unknown, durability?: unknown, note?: unknown, notes?: unknown }} form
 * @param {{ now?: number, id?: string }} [options]
 */
export function createEntry(form, { now = Date.now(), id = newId(now) } = {}) {
  return normalizeEntry(
    {
      id,
      createdAt: new Date(now).toISOString(),
      code: form.code,
      label: form.label,
      inputs: {
        scraps: form.scraps,
        steel: form.steel,
        scrapPrice: form.scrapPrice,
        steelPrice: form.steelPrice,
        priceSource: form.priceSource,
      },
      result: {
        rarity: form.rarity,
        stat: form.stat,
        durability: form.durability,
        note: form.note,
      },
      state: "crafted",
      notes: form.notes,
    },
    now,
  );
}

/**
 * Move an entry along: list it, record its sale, keep it, scrap it, or take
 * it off the market. Returns a new entry, or null for a move that makes no
 * sense (selling without proceeds, listing a sold piece).
 * @param {Entry} entry
 * @param {{ type: "list", price?: unknown, at?: unknown } | { type: "sell", proceeds: unknown, at?: unknown } | { type: "keep" } | { type: "scrap" } | { type: "unlist" }} event
 * @param {number} [now]
 */
export function transition(entry, event, now = Date.now()) {
  const at = new Date(now).toISOString();
  if (entry.state === "sold") return null;
  switch (event.type) {
    case "list": {
      const price = money(event.price);
      return normalizeEntry(
        {
          ...entry,
          state: "listed",
          listing: { price, at: when(event.at) ?? at },
          updatedAt: at,
        },
        now,
      );
    }
    case "sell": {
      const proceeds = money(event.proceeds);
      if (proceeds == null) return null;
      return normalizeEntry(
        {
          ...entry,
          state: "sold",
          sale: { proceeds, at: when(event.at) ?? at, source: "manual" },
          updatedAt: at,
        },
        now,
      );
    }
    case "keep":
      return normalizeEntry({ ...entry, state: "kept", updatedAt: at }, now);
    case "scrap":
      return normalizeEntry(
        { ...entry, state: "scrapped", updatedAt: at },
        now,
      );
    case "unlist":
      return normalizeEntry(
        {
          ...entry,
          state: "crafted",
          listing: { price: null, at: null },
          updatedAt: at,
        },
        now,
      );
    default:
      return null;
  }
}

/**
 * The ledger's totals. Realized profit counts recorded sales only, and only
 * those whose cost basis is known; everything still open is estimated at
 * `estimateFor(code)` when an estimate exists, and said to be an estimate.
 * @param {ReadonlyArray<Entry>} entries @param {{ estimateFor?: (code: string | null) => number | null }} [options]
 */
export function summarize(entries, { estimateFor = () => null } = {}) {
  const sold = { n: 0, proceeds: 0, cost: 0, realized: 0, unknownCost: 0 };
  const open = { n: 0, cost: 0, unknownCost: 0, estimated: 0, covered: 0 };
  let inferred = 0;
  let manual = 0;
  for (const e of entries) {
    if (e.inputs.priceSource === "inferred") inferred++;
    else manual++;
    if (e.state === "sold") {
      sold.n++;
      sold.proceeds += e.sale.proceeds ?? 0;
      if (e.costBasis == null) sold.unknownCost++;
      else {
        sold.cost += e.costBasis;
        sold.realized += (e.sale.proceeds ?? 0) - e.costBasis;
      }
    } else if (e.state === "crafted" || e.state === "listed") {
      open.n++;
      if (e.costBasis == null) open.unknownCost++;
      else open.cost += e.costBasis;
      const est = estimateFor(e.code);
      if (est != null && Number.isFinite(est)) {
        open.estimated += est;
        open.covered++;
      }
    }
  }
  return { count: entries.length, sold, open, inferred, manual };
}

/** @param {ReadonlyArray<Entry>} entries @param {number} [now] */
export function exportLedger(entries, now = Date.now()) {
  return JSON.stringify(
    {
      app: "WarEra Plus",
      kind: "craft-ledger",
      version: LEDGER_VERSION,
      exportedAt: new Date(now).toISOString(),
      entries,
    },
    null,
    2,
  );
}

/**
 * Merge an exported file into `existing`: entries are matched by id, the
 * newer `updatedAt` wins, malformed entries are counted and skipped, and the
 * list is bounded. A file that is not a ledger yields an error, not a merge.
 * @param {string} textValue @param {ReadonlyArray<Entry>} [existing] @param {number} [now]
 */
export function importLedger(textValue, existing = [], now = Date.now()) {
  let parsed;
  try {
    parsed = JSON.parse(String(textValue ?? ""));
  } catch {
    return {
      entries: [...existing],
      added: 0,
      updated: 0,
      skipped: 0,
      error: "not JSON",
    };
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.entries;
  if (
    !Array.isArray(list) ||
    (parsed?.kind != null && parsed.kind !== "craft-ledger")
  )
    return {
      entries: [...existing],
      added: 0,
      updated: 0,
      skipped: 0,
      error: "not a craft ledger export",
    };
  const byId = new Map(existing.map((e) => [e.id, e]));
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const raw of list) {
    const e = normalizeEntry(raw, now);
    if (!e) {
      skipped++;
      continue;
    }
    const old = byId.get(e.id);
    if (!old) {
      byId.set(e.id, e);
      added++;
    } else if (Date.parse(e.updatedAt) > Date.parse(old.updatedAt)) {
      byId.set(e.id, e);
      updated++;
    }
  }
  const entries = [...byId.values()]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MAX_ENTRIES);
  return { entries, added, updated, skipped, error: null };
}

/**
 * Deleted ids with the time of deletion, validated and bounded to the newest.
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
export function normalizeTombstones(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const pairs = Object.entries(/** @type {Record<string, unknown>} */ (raw))
    .filter(([id]) => /^[A-Za-z0-9_-]{4,40}$/.test(id))
    .map(([id, at]) => [id, when(at)])
    .filter((pair) => pair[1] != null)
    .sort(
      (a, b) =>
        Date.parse(/** @type {string} */ (b[1])) -
        Date.parse(/** @type {string} */ (a[1])),
    )
    .slice(0, MAX_TOMBSTONES);
  return Object.fromEntries(pairs);
}

/**
 * A stored ledger, validated and bounded; what the worker keeps. `revision`
 * counts the writes so a tab can tell whether another tab wrote since it
 * read; `tombstones` remember recent deletions.
 * @param {unknown} raw @param {number} [now]
 */
export function normalizeLedger(raw, now = Date.now()) {
  const r = /** @type {any} */ (raw);
  const list = Array.isArray(raw) ? raw : r?.entries;
  const entries = (Array.isArray(list) ? list : [])
    .map((e) => normalizeEntry(e, now))
    .filter((e) => e != null)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MAX_ENTRIES);
  const revision = Number(r?.revision);
  return {
    version: LEDGER_VERSION,
    revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
    entries,
    tombstones: normalizeTombstones(r?.tombstones),
  };
}

/**
 * Merge a tab's list into the stored one: by id, the newer `updatedAt` wins,
 * the ids this tab removed go (and are remembered), and an id deleted
 * elsewhere after this copy was last touched stays deleted. Both sides keep
 * their new entries. Pure; the worker applies it on every write.
 * @param {{ stored: ReadonlyArray<Entry>, incoming: ReadonlyArray<Entry>, removed?: ReadonlyArray<string>, tombstones?: Record<string, string>, now?: number }} input
 */
export function mergeLedgers({
  stored,
  incoming,
  removed = [],
  tombstones = {},
  now = Date.now(),
}) {
  const dead = { ...tombstones };
  const at = new Date(now).toISOString();
  for (const id of removed) dead[String(id)] = at;
  const byId = new Map(stored.map((e) => [e.id, e]));
  for (const e of incoming) {
    const buried = dead[e.id];
    if (buried && Date.parse(buried) >= Date.parse(e.updatedAt)) continue;
    const old = byId.get(e.id);
    if (!old || Date.parse(e.updatedAt) >= Date.parse(old.updatedAt))
      byId.set(e.id, e);
  }
  for (const id of removed) byId.delete(String(id));
  return {
    entries: [...byId.values()]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, MAX_ENTRIES),
    tombstones: normalizeTombstones(dead),
  };
}
