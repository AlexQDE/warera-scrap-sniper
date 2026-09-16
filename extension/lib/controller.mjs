import {
  fetchBook,
  fetchBooks,
  fetchSales,
  fetchEquipmentAvg,
  holdUntil,
} from "./api.mjs";
import { CASE_CODES, WOODEN_CODES, ALL_GEAR_CODES } from "./cases.mjs";
import { makeSingleFlight } from "./flight.mjs";
import { preferences } from "./settings.mjs";
import { CACHE_VERSION, TTL, freshness } from "./quality.mjs";

const CASE_BOOKS = [
  ...new Set([...CASE_CODES, ...WOODEN_CODES, "scraps", "oil"]),
];
const ITEM_CODES = new Set(ALL_GEAR_CODES);
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
            ...(await fetchSales(fetchImpl, key, code, { now: now() })),
            code,
            hours: 72,
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
                  k.startsWith("sales:"),
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
        await storage.remove(
          Object.keys(all).filter(
            (k) =>
              ["book", "cases", "avg"].includes(k) || k.startsWith("sales:"),
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
        (k) => ["book", "cases", "avg"].includes(k) || k.startsWith("sales:"),
      );
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
      if (["book", "cases", "avg", "sales"].includes(msg?.type)) {
        if (msg.type === "sales" && !ITEM_CODES.has(msg.itemCode))
          return { error: "bad-item", message: "Unknown equipment item" };
        return read(msg.type, !!msg.force, msg.itemCode);
      }
      return {
        error: "unknown-message",
        message: "Unknown WarEra Lens request",
      };
    },
  };
}
