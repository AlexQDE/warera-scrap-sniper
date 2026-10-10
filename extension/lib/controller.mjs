import {
  fetchBook,
  fetchBooks,
  fetchSales,
  fetchEquipmentAvg,
  fetchHistoryPage,
  fetchInputAverages,
  fetchOwner,
  isId,
  holdUntil,
} from "./api.mjs";
import { CASE_CODES, WOODEN_CODES, ALL_GEAR_CODES } from "./cases.mjs";
import { makeSingleFlight } from "./flight.mjs";
import { preferences } from "./settings.mjs";
import { CACHE_VERSION, TTL, freshness } from "./quality.mjs";
import { replayHistory, windowView, localDayOf, memoDay } from "./observed.mjs";
import { similarValue, WINDOW_HOURS } from "./similar.mjs";
import { comparableFills } from "./resale.mjs";
import { positive } from "./quality.mjs";

const CASE_BOOKS = [
  ...new Set([...CASE_CODES, ...WOODEN_CODES, "scraps", "oil"]),
];
const ITEM_CODES = new Set(ALL_GEAR_CODES);
/** The player's history store: every transaction of theirs since the start of the profile, kept by month. */
export const HIST_VERSION = 1;
/** Pages of 100 read per step while the history is being filled from the start of the profile. */
export const BACKFILL_PAGES = 8;
/** Pages a poll walks from the top before it gives up meeting a row it holds (the rest is walked as a gap). */
const POLL_PAGES = 5;
/** The newest transaction ids a poll stops at. */
const TOP_IDS = 300;
/** Poll intervals: normal, and while the game's case or craft dialog is open. */
export const POLL_MS = 60_000;
export const FAST_POLL_MS = 15_000;
/** Codes whose daily prices cost the history: the craft inputs and the cases. */
const PRICE_CODES = ["scraps", "steel", "case1", "case2", "woodenCase"];
const AVERAGES_TTL = 600_000;
const errorResult = (e) => ({
  error: e.code ?? "internal",
  message: e.message ?? "Request failed",
});

/** IO is injected so races, storage changes and cooldowns can be tested without the game. */
export function createController({
  storage,
  session,
  fetchImpl,
  now = Date.now,
  random = Math.random,
}) {
  const once = makeSingleFlight();
  let writes = Promise.resolve();
  let generation = 0;
  let hold = 0;
  const cooldowns = new Map();
  const ready = session.get(["apiHoldUntil"]).then((s) => {
    hold = s.apiHoldUntil ?? 0;
  });
  const serial = (fn) => {
    const p = writes.then(fn);
    writes = p.catch(() => {});
    return p;
  };
  const iso = () => new Date(now()).toISOString();
  const valid = (cache) => cache?.cacheVersion === CACHE_VERSION;
  const keyOf = (s) => String(s?.apiKey ?? "").trim();

  async function fail(e, token) {
    if (e.code === "rate-limited") {
      hold = Math.max(hold, holdUntil(e.retryAfter, now()));
      await session.set({ apiHoldUntil: hold });
    }
    const previous = cooldowns.get(token)?.attempt ?? 0;
    const delay =
      e.code === "key-rejected"
        ? 60_000
        : Math.min(60_000, 5000 * 2 ** previous) + random() * 1000;
    cooldowns.set(token, {
      until: now() + delay,
      attempt: Math.min(previous + 1, 5),
      ...errorResult(e),
    });
  }

  async function read(kind, force, code) {
    const token = `${generation}:${kind}:${code ?? ""}`;
    return once(token, async () => {
      await ready;
      const cacheKey = kind === "sales" ? `sales:${code}` : kind;
      const got = await storage.get([
        "settings",
        "rejectedAuthRevision",
        cacheKey,
      ]);
      const key = keyOf(got.settings);
      if (!key)
        return { error: "no-key", message: "Add your API key in settings" };
      const authRevision = Number(got.settings?.authRevision) || 0;
      if (got.rejectedAuthRevision === authRevision)
        return {
          error: "key-rejected",
          message: "API key rejected. Check and save your key in settings.",
        };
      const version = generation;
      const cache = valid(got[cacheKey]) ? got[cacheKey] : null;
      const ttl =
        kind === "book"
          ? preferences(got.settings).intervalSec * 1000
          : TTL[kind];
      const wrapper = (value) => ({ [kind]: value });
      if (
        !force &&
        cache &&
        !Object.keys(cache.failures ?? {}).length &&
        freshness(cache.at, ttl, now()) === "fresh"
      )
        return wrapper(cache);
      if (hold > now())
        return {
          ...wrapper(cache),
          error: "rate-limited",
          message: `Rate limited; retry in ${Math.ceil((hold - now()) / 1000)}s`,
        };
      const backoff = cooldowns.get(token);
      if (backoff?.until > now())
        return {
          ...wrapper(cache),
          error: backoff.error,
          message: `${backoff.message}; retry in ${Math.ceil((backoff.until - now()) / 1000)}s`,
        };
      try {
        let result;
        if (kind === "book") result = (await fetchBook(fetchImpl, key)).book;
        else if (kind === "cases")
          result = await fetchBooks(fetchImpl, key, CASE_BOOKS);
        else if (kind === "sales")
          result = {
            ...(await fetchSales(fetchImpl, key, code, {
              now: now(),
              hours: 168,
              maxPages: 10,
            })),
            code,
            hours: 168,
          };
        else {
          const fetched = await fetchEquipmentAvg(
            fetchImpl,
            key,
            ALL_GEAR_CODES,
          );
          const values = { ...(cache?.values ?? {}) };
          const times = { ...(cache?.times ?? {}) };
          for (const item of ALL_GEAR_CODES) {
            if (fetched.failures[item]) continue;
            values[item] = fetched.avg[item];
            times[item] = iso();
          }
          result = {
            values,
            times,
            failures: fetched.failures,
            missing: fetched.missing,
          };
          if (Object.keys(fetched.failures).length)
            await fail(
              {
                code: "partial",
                message: `${Object.keys(fetched.failures).length} average prices failed to refresh`,
              },
              token,
            );
        }
        const partial =
          kind === "avg" && Object.keys(result.failures).length > 0;
        const fresh = {
          ...result,
          at: partial ? (cache?.at ?? null) : iso(),
          attemptedAt: iso(),
          cacheVersion: CACHE_VERSION,
        };
        const saved = await serial(async () => {
          const { settings } = await storage.get(["settings"]);
          if (generation !== version || keyOf(settings) !== key) return false;
          await storage.set({ [cacheKey]: fresh });
          return true;
        });
        if (!saved)
          return {
            error: "superseded",
            message: "Settings changed; refresh required",
          };
        if (!partial) cooldowns.delete(token);
        return {
          ...wrapper(fresh),
          ...(partial
            ? {
                error: "partial",
                message: "Some averages failed; prior values retained",
              }
            : {}),
        };
      } catch (e) {
        if (version !== generation)
          return {
            error: "superseded",
            message: "Settings changed; refresh required",
          };
        if (e.code === "key-rejected")
          await serial(async () => {
            const { settings } = await storage.get(["settings"]);
            if (version !== generation || keyOf(settings) !== key) return;
            generation++;
            const all = await storage.get(null);
            await storage.remove(
              Object.keys(all).filter(
                (k) =>
                  ["book", "cases", "avg"].includes(k) ||
                  k.startsWith("sales:") ||
                  k.startsWith("crafts:"),
              ),
            );
            await storage.set({ rejectedAuthRevision: authRevision });
          });
        await fail(e, token);
        return {
          ...wrapper(e.code === "key-rejected" ? null : cache),
          ...errorResult(e),
        };
      }
    });
  }

  async function patchSettings(patch, trusted) {
    return serial(async () => {
      const { settings = {}, rejectedAuthRevision } = await storage.get([
        "settings",
        "rejectedAuthRevision",
      ]);
      const savesKey = trusted && Object.hasOwn(patch, "apiKey");
      const nextKey = savesKey ? keyOf(patch) : keyOf(settings);
      const resetsAuth =
        nextKey !== keyOf(settings) ||
        (savesKey &&
          rejectedAuthRevision === (Number(settings.authRevision) || 0));
      const next = {
        ...preferences({ ...settings, ...patch }),
        revision: (Number(settings.revision) || 0) + 1,
        authRevision:
          (Number(settings.authRevision) || 0) + (resetsAuth ? 1 : 0),
        apiKey: nextKey,
      };
      if (resetsAuth) {
        generation++;
        cooldowns.clear();
        const all = await storage.get(null);
        // The history store (hist:<userId>:*) is the player's own record, keyed by the id the page shows: it survives a key change.
        await storage.remove(
          Object.keys(all).filter(
            (k) =>
              ["book", "cases", "avg"].includes(k) ||
              k.startsWith("sales:") ||
              k.startsWith("crafts:"),
          ),
        );
        await storage.remove("rejectedAuthRevision");
      }
      await storage.set({ settings: next });
      return {
        settings: preferences(next),
        hasKey: !!next.apiKey,
        revision: next.revision,
        authRevision: next.authRevision,
      };
    });
  }

  async function cleanup() {
    return serial(async () => {
      const all = await storage.get(null);
      const keys = Object.keys(all).filter(
        (k) =>
          ["book", "cases", "avg"].includes(k) ||
          k.startsWith("sales:") ||
          k.startsWith("crafts:"),
      );
      // The 2.2 feed store is replaced by the history store (hist:*), which cleanup never touches.
      const staleFeeds = Object.keys(all).filter((k) => k.startsWith("feed:"));
      if (staleFeeds.length) await storage.remove(staleFeeds);
      const ordered = keys
        .filter((k) => k.startsWith("sales:"))
        .sort(
          (a, b) => Date.parse(all[b]?.at ?? "") - Date.parse(all[a]?.at ?? ""),
        );
      const remove = keys.filter(
        (k) =>
          !valid(all[k]) ||
          !Number.isFinite(Date.parse(all[k].at)) ||
          now() - Date.parse(all[k].at) > 7 * 86400_000 ||
          (k.startsWith("sales:") &&
            (ordered.indexOf(k) >= 36 || !ITEM_CODES.has(k.slice(6)))),
      );
      if (remove.length) await storage.remove(remove);
      await storage.set({
        settings: {
          ...preferences(all.settings),
          revision: (Number(all.settings?.revision) || 0) + 1,
          authRevision: Number(all.settings?.authRevision) || 0,
          apiKey: keyOf(all.settings),
        },
      });
    });
  }

  // ---- the player's history ----
  const metaKey = (u) => `hist:${u}:meta`;
  const chunkKey = (u, month) => `hist:${u}:${month}`;
  const monthOf = (iso) => String(iso).slice(0, 7);
  const freshMeta = (userId) => ({
    v: HIST_VERSION,
    userId,
    username: null,
    done: false,
    cursor: null,
    gap: null,
    pages: 0,
    top: [],
    months: [],
    count: 0,
    oldestAt: null,
    newestAt: null,
    resources: [],
    averages: {},
    averagesAt: null,
    rev: 0,
    at: null,
    startedAt: iso(),
  });
  /** Merge rows into their month chunks (deduplicated by transaction id); returns how many were new and which ids were already held. */
  async function mergeRows(meta, rows) {
    if (!rows.length) return { added: 0, seen: new Set() };
    /** @type {Map<string, any[]>} */
    const byMonth = new Map();
    for (const r of rows) {
      const m = monthOf(r.a);
      byMonth.set(m, [...(byMonth.get(m) ?? []), r]);
    }
    const keys = [...byMonth.keys()].map((m) => chunkKey(meta.userId, m));
    const got = await storage.get(keys);
    const seen = new Set();
    let added = 0;
    const writes = {};
    for (const [m, incoming] of byMonth) {
      const key = chunkKey(meta.userId, m);
      const held = Array.isArray(got[key]) ? got[key] : [];
      const ids = new Set(held.map((r) => r.x));
      const fresh = [];
      for (const r of incoming)
        if (ids.has(r.x)) seen.add(r.x);
        else {
          ids.add(r.x);
          fresh.push(r);
        }
      if (!fresh.length) continue;
      added += fresh.length;
      writes[key] = [...fresh, ...held].sort(
        (x, y) => Date.parse(y.a) - Date.parse(x.a),
      );
      if (!meta.months.includes(m)) meta.months = [...meta.months, m].sort();
    }
    if (added) {
      await storage.set(writes);
      meta.count += added;
      for (const r of rows) {
        if (!meta.oldestAt || r.a < meta.oldestAt) meta.oldestAt = r.a;
        if (!meta.newestAt || r.a > meta.newestAt) meta.newestAt = r.a;
        // a wooden case gives a resource: its price is needed to value it
        if (r.y === "openCase" && !r.i && r.c && !meta.resources.includes(r.c))
          meta.resources = [...meta.resources, r.c];
      }
      meta.rev++;
    }
    return { added, seen };
  }
  const publicMeta = (meta) =>
    meta && {
      userId: meta.userId,
      username: meta.username,
      done: meta.done,
      gap: !!meta.gap,
      pages: meta.pages,
      count: meta.count,
      oldestAt: meta.oldestAt,
      newestAt: meta.newestAt,
      rev: meta.rev,
      at: meta.at,
    };

  /**
   * One step of the player's history: a poll from the newest row down to the
   * first one already held (at most every POLL_MS, FAST_POLL_MS while a game
   * dialog is open, or at once when forced), then, until the history reaches
   * the start of the profile, BACKFILL_PAGES more pages from where the last
   * step stopped. Each page is stored as it arrives, so a step that is cut
   * short loses nothing. The store is the player's: a key change keeps it.
   */
  async function readHistory(userId, { force = false, fast = false } = {}) {
    const token = `${generation}:history:${userId}`;
    return once(token, async () => {
      await ready;
      const got = await storage.get([
        "settings",
        "rejectedAuthRevision",
        metaKey(userId),
      ]);
      const key = keyOf(got.settings);
      if (!key)
        return { error: "no-key", message: "Add your API key in settings" };
      const authRevision = Number(got.settings?.authRevision) || 0;
      if (got.rejectedAuthRevision === authRevision)
        return {
          error: "key-rejected",
          message: "API key rejected. Check and save your key in settings.",
        };
      const stored = got[metaKey(userId)];
      const meta =
        stored?.v === HIST_VERSION && stored.userId === userId
          ? stored
          : freshMeta(userId);
      const interval = fast ? FAST_POLL_MS : POLL_MS;
      const pollDue =
        force || !meta.at || now() - Date.parse(meta.at) >= interval;
      if (!pollDue && meta.done && !meta.gap)
        return { history: publicMeta(meta) };
      if (hold > now())
        return {
          history: publicMeta(meta),
          error: "rate-limited",
          message: `Rate limited; retry in ${Math.ceil((hold - now()) / 1000)}s`,
        };
      const backoff = cooldowns.get(token);
      if (backoff?.until > now())
        return {
          history: publicMeta(meta),
          error: backoff.error,
          message: `${backoff.message}; retry in ${Math.ceil((backoff.until - now()) / 1000)}s`,
        };
      const version = generation;
      const page = (cursor) =>
        fetchHistoryPage(fetchImpl, key, userId, { cursor, now: now() });
      try {
        let budget = BACKFILL_PAGES;
        if (pollDue) {
          if (!meta.top.length) {
            // the first step: the newest page starts both the top and the backfill
            const first = await page(null);
            budget--;
            meta.pages++;
            await mergeRows(meta, first.rows);
            meta.top = first.rows.map((r) => r.x).slice(0, TOP_IDS);
            meta.cursor = first.next;
            if (!first.next) meta.done = true;
          } else {
            const known = new Set(meta.top);
            let cursor = null;
            let met = false;
            const fresh = [];
            for (let i = 0; i < POLL_PAGES && budget > 0; i++) {
              const pg = await page(cursor);
              budget--;
              for (const r of pg.rows) {
                if (known.has(r.x)) {
                  met = true;
                  break;
                }
                fresh.push(r);
              }
              if (met || !pg.next) {
                met = true;
                break;
              }
              cursor = pg.next;
            }
            await mergeRows(meta, fresh);
            meta.top = [...fresh.map((r) => r.x), ...meta.top].slice(
              0,
              TOP_IDS,
            );
            // more new rows than a poll reads: the rest is walked down as a gap until a held row is met
            if (!met && cursor) meta.gap = cursor;
          }
          meta.at = iso();
        }
        if (meta.gap && budget > 0) {
          let cursor = meta.gap;
          while (cursor && budget > 0) {
            const pg = await page(cursor);
            budget--;
            const { seen } = await mergeRows(meta, pg.rows);
            cursor = seen.size || !pg.next ? null : pg.next;
          }
          meta.gap = cursor;
        }
        while (!meta.done && budget > 0) {
          const pg = await page(meta.cursor);
          budget--;
          meta.pages++;
          await mergeRows(meta, pg.rows);
          meta.cursor = pg.next;
          if (!pg.next) meta.done = true;
        }
        // the daily prices that cost the history, kept as they are read (the game serves 30 days)
        if (
          !meta.averagesAt ||
          now() - Date.parse(meta.averagesAt) > AVERAGES_TTL
        ) {
          const codes = [...PRICE_CODES, ...meta.resources.slice(0, 20)];
          const { averages } = await fetchInputAverages(fetchImpl, key, codes);
          for (const [code, table] of Object.entries(averages))
            meta.averages[code] = { ...(meta.averages[code] ?? {}), ...table };
          meta.averagesAt = iso();
          meta.rev++;
        }
        if (meta.username == null)
          meta.username =
            (await fetchOwner(fetchImpl, key, userId)).username ?? "";
        const saved = await serial(async () => {
          const { settings } = await storage.get(["settings"]);
          if (generation !== version || keyOf(settings) !== key) return false;
          await storage.set({ [metaKey(userId)]: meta });
          return true;
        });
        if (!saved)
          return {
            error: "superseded",
            message: "Settings changed; refresh required",
          };
        cooldowns.delete(token);
        return { history: publicMeta(meta) };
      } catch (e) {
        // the pages already merged stay: save where the walk got to
        await storage.set({ [metaKey(userId)]: meta }).catch(() => {});
        if (version !== generation)
          return {
            error: "superseded",
            message: "Settings changed; refresh required",
          };
        if (e.code === "key-rejected")
          await serial(async () => {
            const { settings } = await storage.get(["settings"]);
            if (version !== generation || keyOf(settings) !== key) return;
            generation++;
            const keys = await storage.get(null);
            await storage.remove(
              Object.keys(keys).filter(
                (k) =>
                  ["book", "cases", "avg"].includes(k) ||
                  k.startsWith("sales:"),
              ),
            );
            await storage.set({ rejectedAuthRevision: authRevision });
          });
        await fail(e, token);
        return { history: publicMeta(meta), ...errorResult(e) };
      }
    });
  }

  /** The replayed history, kept in memory per revision and steel mode (the worker may restart: it is rebuilt from storage). */
  const replayMemo = { key: "", value: null, rows: 0 };
  async function replayed(userId, steelMode) {
    const meta = (await storage.get([metaKey(userId)]))[metaKey(userId)];
    if (meta?.v !== HIST_VERSION) return null;
    const memoKey = `${userId}|${meta.rev}|${steelMode}`;
    if (replayMemo.key !== memoKey) {
      const chunks = await storage.get(
        meta.months.map((m) => chunkKey(userId, m)),
      );
      const rows = meta.months.flatMap(
        (m) => chunks[chunkKey(userId, m)] ?? [],
      );
      replayMemo.key = memoKey;
      replayMemo.value = replayHistory(rows, {
        averages: meta.averages,
        steelMode,
      });
      replayMemo.rows = rows.length;
    }
    return { meta, history: replayMemo.value };
  }

  /**
   * What the Ledger and the game's dialogs show, computed here so the page
   * never receives the whole history: the result by activity for today, 7
   * days, 30 days and everything, per case and per crafted tier; the recent
   * pieces; the last crafted and opened piece; the codes whose sales would
   * price the held pieces; today's crafts, newest first. A held piece is
   * valued at the sales of its own stats when its item's sales were read,
   * else at the game's average. In "eco" mode gear worn in battle is left
   * out of the results; "war" counts it.
   */
  async function ledgerView(
    userId,
    { steelMode = "random", window = "today", mode = "eco" } = {},
  ) {
    const r = await replayed(userId, steelMode);
    if (!r) return { ledger: null };
    const { meta, history } = r;
    const countWorn = mode === "war";
    const day = memoDay(localDayOf);
    const today = day(iso());
    const heldCount = new Map();
    for (const p of history.pieces)
      if (p.fate === "held")
        heldCount.set(p.code, (heldCount.get(p.code) ?? 0) + 1);
    const last = (src) =>
      history.pieces.filter((p) => p.source === src && p.at).at(-1) ?? null;
    const lastCrafted = last("crafted");
    const lastOpened = last("opened");
    const craftsToday = [];
    for (let i = history.pieces.length - 1; i >= 0; i--) {
      const p = history.pieces[i];
      if (p.source !== "crafted" || !p.at) continue;
      const d = day(p.at);
      if (d > today) continue; // the server's clock ahead of this one around midnight
      if (d < today) break;
      craftsToday.push(p);
    }
    const codes = [
      ...new Set([
        ...craftsToday.map((p) => p.code),
        ...[lastCrafted, lastOpened].filter(Boolean).map((p) => p.code),
        ...[...heldCount.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c),
      ]),
    ];
    const caches = await storage.get([
      "avg",
      ...codes.map((c) => `sales:${c}`),
    ]);
    const avgValues = caches.avg?.values ?? {};
    /** @type {Map<string, any[]>} */
    const fillsOf = new Map();
    const valueDetail = (p) => {
      const sales = caches[`sales:${p.code}`];
      if (sales?.fills) {
        let fills = fillsOf.get(p.code);
        if (!fills) {
          fills = comparableFills(sales.fills, {
            code: p.code,
            hours: WINDOW_HOURS,
            now: now(),
            state: null,
          });
          fillsOf.set(p.code, fills);
        }
        const v = similarValue(p.code, p.skills, fills);
        if (v.value != null) return { value: v.value, label: v.label };
      }
      const a = positive(avgValues[p.code]);
      return a != null ? { value: a, label: "game avg, any stats" } : null;
    };
    const valueOf = (p) => valueDetail(p)?.value ?? null;
    const back = (days) => day(new Date(now() - days * 86400e3).toISOString());
    const view = (from, to) =>
      windowView(history, { from, to, valueOf, countWorn, dayOf: day });
    const windows = {
      today: view(today, today),
      week: view(back(6), today),
      month: view(back(29), today),
      all: view("0000", "9999"),
    };
    const from =
      { today, week: back(6), month: back(29), all: "0000" }[window] ?? today;
    const inWindow = (iso_) => {
      const d = day(iso_);
      return d >= from && d <= today;
    };
    const describe = (p) =>
      p && {
        id: p.id,
        code: p.code,
        rarity: p.rarity,
        skills: p.skills,
        source: p.source,
        via: p.via,
        at: p.at,
        cost: p.cost,
        approx: p.approx,
        fate: p.fate,
        proceeds: p.proceeds,
        goneAt: p.goneAt,
        sellsHours: p.sellsHours,
        worn: p.worn,
        value: p.fate === "held" ? valueDetail(p) : null,
      };
    const recent = history.pieces
      .filter((p) => inWindow(p.goneAt) || inWindow(p.at))
      .map((p) => ({ p, t: Date.parse(p.goneAt ?? p.at ?? "") }))
      .sort((x, y) => y.t - x.t)
      .map((x) => x.p);
    return {
      ledger: {
        meta: publicMeta(meta),
        mode: countWorn ? "war" : "eco",
        windows,
        craftsToday: craftsToday.slice(0, 60).map(describe),
        craftsTodayTotal: craftsToday.length,
        rows: recent.slice(0, 80).map(describe),
        rowsTotal: recent.length,
        lastCrafted: describe(lastCrafted),
        lastOpened: describe(lastOpened),
        held: { n: [...heldCount.values()].reduce((a, b) => a + b, 0) },
        salesWanted: codes.slice(0, 8),
        trades: history.trades,
        approxBefore:
          Object.keys(meta.averages?.scraps ?? {}).sort()[0] ?? null,
        at: iso(),
      },
    };
  }

  return {
    cleanup,
    async handle(msg, { trusted = false } = {}) {
      if (msg?.type === "getSettings") {
        const { settings = {}, rejectedAuthRevision } = await storage.get([
          "settings",
          "rejectedAuthRevision",
        ]);
        return {
          settings: preferences(settings),
          hasKey: !!keyOf(settings),
          revision: settings.revision ?? 0,
          authRevision: settings.authRevision ?? 0,
          rejected:
            rejectedAuthRevision === (Number(settings.authRevision) || 0),
          ...(trusted ? { apiKey: keyOf(settings) } : {}),
        };
      }
      if (msg?.type === "saveSettings")
        return patchSettings(msg.settings ?? {}, trusted);
      if (msg?.type === "testKey") {
        if (!trusted)
          return {
            error: "forbidden",
            message: "Use extension settings to test a key",
          };
        await ready;
        if (hold > now())
          return {
            ok: false,
            error: "rate-limited",
            message: "Wait for the API cooldown",
          };
        const testToken = `testKey:${String(msg.key ?? "")}`;
        if (cooldowns.get(testToken)?.until > now())
          return {
            ok: false,
            error: "cooldown",
            message: "Wait before testing this key again",
          };
        return once(testToken, async () => {
          try {
            const r = await fetchBook(fetchImpl, msg.key);
            return {
              ok: true,
              ...r.book,
              limit: r.limit,
              remaining: r.remaining,
            };
          } catch (e) {
            await fail(e, testToken);
            return { ok: false, ...errorResult(e) };
          }
        });
      }
      if (msg?.type === "history" || msg?.type === "ledger") {
        if (!isId(msg.userId))
          return { error: "bad-user", message: "Unknown player id" };
        if (msg.type === "history")
          return readHistory(msg.userId, {
            force: !!msg.force,
            fast: !!msg.fast,
          });
        const { settings } = await storage.get(["settings"]);
        return ledgerView(msg.userId, {
          steelMode: preferences(settings).craftSteelMode,
          mode: preferences(settings).ledgerMode,
          window: String(msg.window ?? "today"),
        });
      }
      if (["book", "cases", "avg", "sales"].includes(msg?.type)) {
        if (msg.type === "sales" && !ITEM_CODES.has(msg.itemCode))
          return { error: "bad-item", message: "Unknown equipment item" };
        return read(msg.type, !!msg.force, msg.itemCode);
      }
      return {
        error: "unknown-message",
        message: "Unknown WarEra Plus request",
      };
    },
  };
}
