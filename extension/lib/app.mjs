import * as dom from "./dom.mjs";
import { DEFAULTS } from "./settings.mjs";
import { TTL, freshness, quote } from "./quality.mjs";
import { snapshotSummary } from "./cases.mjs";
import { createEquipment } from "./equipment.mjs";
import { createCraftDesk } from "./craftdesk.mjs";
import { casesStripHtml, tripLineHtml } from "./casesview.mjs";
import { panel, setHtml, notice, clock } from "./ui.mjs";
import { createScheduler } from "./scheduler.mjs";

export async function startLens(runtime = chrome.runtime) {
  const state = {
    settings: { ...DEFAULTS },
    revision: null,
    authRevision: null,
    rejected: false,
    setup: null,
    invalidated: false,
    book: null,
    cases: null,
    avg: null,
    sales: null,
    salesByCode: {},
    salesErrors: {},
    salesReading: null,
    ledger: null,
    taxOnPage: null,
    errors: {},
    busy: new Set(),
  };
  const SALES_CODES_KEPT = 12;
  const SALES_RETRY_MS = 15_000; // a failed or empty sales read is not asked again at once
  const salesAttempts = new Map(); // code -> last attempt
  const salesPending = new Map(); // code -> forced?: sales reads asked for while another item's read was in flight
  let context = {};
  let disposed = false;
  let timer;
  let ticking = false;
  let href = location.href;
  let lastScan = 0;
  let freshSignature = "";
  let roots = [];
  let salesWanted = null;
  const signature = () =>
    ["book", "cases", "avg"]
      .map((k) =>
        freshness(
          state[k]?.at,
          k === "book" ? state.settings.intervalSec * 1000 : TTL[k],
        ),
      )
      .join(":");
  const metrics = { scans: 0, scanMs: 0, maxScanMs: 0 };
  const sched = createScheduler(scan);
  const send = async (msg) => {
    if (state.invalidated || disposed) return null;
    try {
      return await runtime.sendMessage(msg);
    } catch (e) {
      if (/context invalidated|receiving end does not exist/i.test(e.message)) {
        state.invalidated = true;
        state.setup = "WarEra Plus was updated. Reload this page.";
        sched.schedule();
      } else {
        state.errors[msg.type] = e.message;
      }
      return null;
    }
  };
  function action(name) {
    if (name === "reload") location.reload();
    else if (name === "settings") send({ type: "openSettings" });
  }
  function applySettings(r) {
    if (!r?.settings) return;
    const previousSetup = state.setup;
    if (
      state.revision !== r.revision ||
      state.authRevision !== r.authRevision
    ) {
      const changed =
        state.authRevision != null && state.authRevision !== r.authRevision;
      state.settings = r.settings;
      state.revision = r.revision;
      state.authRevision = r.authRevision;
      if (changed) {
        state.book = null;
        state.cases = null;
        state.avg = null;
        state.sales = null;
        state.salesByCode = {};
        state.salesErrors = {};
        salesAttempts.clear();
        salesPending.clear();
        state.errors = {};
        state.rejected = false;
      }
      sched.schedule();
    }
    if (r.rejected) state.rejected = true;
    state.setup = state.invalidated
      ? "WarEra Plus was updated. Reload this page."
      : state.rejected
        ? "API key rejected. Check and save your key in settings."
        : r.hasKey
          ? null
          : "Add your WarEra API key in extension settings.";
    if (previousSetup !== state.setup) sched.schedule();
  }
  const save = async (patch) => {
    const r = await send({ type: "saveSettings", settings: patch });
    applySettings(r);
    scan();
    void fetchVisible();
    return r?.settings ?? null;
  };
  async function read(kind, force = false, code) {
    if (disposed || document.hidden || state.setup || state.invalidated) return;
    if (state.busy.has(kind)) {
      // Sales reads are single-flight. One asked for while another item's read is in flight is kept, with
      // whether it was forced, and runs when that read finishes; a plain repeat of the item being read is not.
      if (kind === "sales" && code && (force || code !== state.salesReading))
        salesPending.set(code, force || !!salesPending.get(code));
      return;
    }
    const ttl = kind === "book" ? state.settings.intervalSec * 1000 : TTL[kind];
    // Sales are fresh per item: the panel's item and the desk's item each keep their own read.
    const held = kind === "sales" ? state.salesByCode[code] : state[kind];
    if (
      !force &&
      !Object.keys(held?.failures ?? {}).length &&
      freshness(held?.at, ttl) === "fresh"
    )
      return;
    if (
      kind === "sales" &&
      !force &&
      Date.now() - (salesAttempts.get(code) ?? 0) < SALES_RETRY_MS
    )
      return;
    if (kind === "sales") {
      salesAttempts.set(code, Date.now());
      state.salesReading = code;
    }
    state.busy.add(kind);
    const revision = state.authRevision;
    const r = await send({
      type: kind,
      force,
      ...(code ? { itemCode: code } : {}),
    });
    state.busy.delete(kind);
    if (kind === "sales" && state.salesReading === code)
      state.salesReading = null;
    if (!r && kind === "sales")
      state.salesErrors = {
        ...state.salesErrors,
        [code]: state.errors.sales ?? "The extension did not answer",
      };
    if (revision !== state.authRevision || disposed) {
      sched.schedule();
      return;
    }
    if (r) {
      if (r.error === "no-key" || r.error === "key-rejected") {
        state.setup = r.message;
        state.rejected = r.error === "key-rejected";
        state.book = null;
        state.cases = null;
        state.avg = null;
        state.sales = null;
        state.salesByCode = {};
        state.salesErrors = {};
      } else {
        if (r[kind]) state[kind] = r[kind];
        if (kind === "sales" && r.sales?.code) {
          // Keep the last few items' fills so rows of other codes keep their resale evidence.
          const rest = { ...state.salesByCode };
          delete rest[r.sales.code];
          const kept = Object.entries(rest).slice(-(SALES_CODES_KEPT - 1));
          state.salesByCode = Object.fromEntries([
            ...kept,
            [r.sales.code, r.sales],
          ]);
        }
        state.errors[kind] = r.error ? r.message : null;
        if (kind === "sales")
          state.salesErrors = {
            ...state.salesErrors,
            [code]: r.error ? r.message : null,
          };
      }
    }
    sched.schedule();
    if (kind === "sales" && !document.hidden) {
      if (salesWanted && salesWanted !== code)
        void read("sales", false, salesWanted);
      drainSales();
    }
  }
  /** Run the sales reads kept while one was in flight, one at a time; the rest wait for the next completion. */
  function drainSales() {
    if (!context.equipment && !context.craft) {
      salesPending.clear();
      return;
    }
    for (const [pendingCode, forced] of [...salesPending]) {
      salesPending.delete(pendingCode);
      void read("sales", forced, pendingCode);
      if (state.busy.has("sales")) return;
    }
  }
  const equipment = createEquipment({
    settings: () => state.settings,
    save,
    refresh: () => {
      void read("book", true);
      if (salesWanted) void read("sales", true, salesWanted);
      sched.schedule();
    },
    requestSales: (code) => {
      salesWanted = code;
      if (context.equipment) void read("sales", false, code);
    },
    rescan: () => sched.schedule(),
  });
  const desk = createCraftDesk({
    settings: () => state.settings,
    save,
    refresh: () => {
      void read("book", true);
      void read("cases", true);
      if (desk.selected) void read("sales", true, desk.selected);
      sched.schedule();
    },
    requestSales: (code) => {
      if (context.craft) void read("sales", false, code);
    },
    rescan: () => sched.schedule(),
    onLedger: async ({ changed = [], removed = [], baseRevision } = {}) => {
      const r = await send({
        type: "ledgerSet",
        // What the desk rendered its rows from, not the newest revision this tab holds: a refresh may have landed in between.
        baseRevision: Number.isSafeInteger(baseRevision) ? baseRevision : 0,
        changed,
        removed,
      });
      adoptLedger(r?.ledger);
      return r;
    },
  });
  /** Take a ledger from the worker only when it is newer than the one held: answers can arrive out of order, and an old one must not roll the desk back. */
  function adoptLedger(ledger) {
    if (!ledger) return false;
    if (state.ledger && !(ledger.revision > state.ledger.revision))
      return false;
    state.ledger = ledger;
    return true;
  }
  let ledgerRequested = false;
  async function loadLedger() {
    if (ledgerRequested || disposed) return;
    ledgerRequested = true;
    const r = await send({ type: "ledgerGet" });
    if (r?.ledger) adoptLedger(r.ledger);
    else ledgerRequested = false; // asked again on the next scan
    sched.schedule();
  }
  /** Another tab may have written: pick up a newer revision while the desk is open. */
  async function refreshLedger() {
    if (!state.ledger || disposed || document.hidden) return;
    const r = await send({ type: "ledgerGet" });
    if (adoptLedger(r?.ledger)) sched.schedule();
  }
  const observer = new MutationObserver((muts) => {
    if (document.hidden || disposed) return;
    const own = (n) =>
      !!(
        n?.closest?.("[data-lens]") ||
        n?.parentElement?.closest?.("[data-lens]")
      );
    if (
      muts.every(
        (m) =>
          own(m.target) ||
          (m.type === "childList" &&
            [...m.addedNodes, ...m.removedNodes].every(own)),
      )
    )
      return;
    sched.schedule();
  });
  function observe(next) {
    next = [...new Set(next.filter((n) => n?.isConnected))];
    if (next.length === roots.length && next.every((n, i) => n === roots[i]))
      return;
    observer.disconnect();
    roots = next;
    for (const root of roots)
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "aria-selected"],
        characterData: true,
      });
  }
  function scan() {
    if (disposed || document.hidden) return;
    const start = performance.now();
    lastScan = Date.now();
    const before = context;
    context = {
      equipment:
        state.settings.equipment &&
        /^\/market\/equipments\/?$/.test(location.pathname),
    };
    const nextRoots = [];
    if (context.equipment) {
      const result = equipment.render({
        ...state,
        error: state.errors.book,
        salesError: state.errors.sales,
        salesErrors: state.salesErrors,
        salesReading: state.salesReading,
        salesBusy: state.busy.has("sales"),
        busy: state.busy.has("book"),
        action,
      });
      if (result) nextRoots.push(...result.roots);
      const dialog = dom.pickerDialog();
      if (dialog) nextRoots.push(dialog);
    } else if (before.equipment) equipment.clear();
    context.craft =
      state.settings.craft &&
      /^\/market\/equipments\/?$/.test(location.pathname);
    if (context.craft) {
      const bar = document.getElementById("scrap-sniper-bar");
      state.taxOnPage = dom.taxRateFromText(dom.taxNotice()?.textContent);
      if (!state.ledger && !state.setup && !state.settings.craftCollapsed)
        void loadLedger();
      // After the equipment bar; without that module, where the bar would go (the tax notice, else the grid's section).
      const result = desk.render(
        {
          ...state,
          busy: state.busy.has("cases") || state.busy.has("book"),
          action,
        },
        bar ?? dom.marketAnchor(),
        { after: !!bar },
      );
      if (result) nextRoots.push(...result.roots);
    } else desk.clear();
    const onCases =
      /^\/market\/?$/.test(location.pathname) ||
      /\/inventory\/?$/.test(location.pathname);
    context.cases = state.settings.cases && onCases ? dom.casesAnchor() : null;
    if (context.cases) {
      const strip = panel("scrap-sniper-cases", context.cases, (e) => {
        const name = e.target.closest("[data-action]")?.dataset.action;
        if (name === "refresh") {
          void read("cases", true);
          if (wantsAverages()) void read("avg", true);
          sched.schedule();
        } else if (name === "collapse")
          save({ casesCollapsed: !state.settings.casesCollapsed });
        else action(name);
      });
      setHtml(
        strip,
        casesStripHtml({
          cases: state.cases
            ? { ...state.cases, avg: state.avg, avgError: state.errors.avg }
            : null,
          error: state.errors.cases,
          notice: state.setup,
          busy: state.busy.has("cases"),
          collapsed: state.settings.casesCollapsed,
          sellFrom: state.settings.sellFrom,
        }),
      );
      nextRoots.push(context.cases.parentElement);
    } else document.getElementById("scrap-sniper-cases")?.remove();
    context.travel = state.settings.travel ? dom.mapLootItem() : null;
    if (context.travel) {
      let line = context.travel.item.querySelector(":scope > .ss-trip");
      if (!line) {
        line = document.createElement("span");
        line.className = "ss-trip";
        line.dataset.lens = "";
        context.travel.item.appendChild(line);
        line.addEventListener("click", (e) => {
          if (e.target.closest("[data-action]")) {
            e.preventDefault();
            e.stopPropagation();
            const name = e.target.closest("[data-action]").dataset.action;
            if (name === "trip-mode")
              save({ roundTrip: !state.settings.roundTrip });
            else action(name);
          }
        });
      }
      for (const el of document.querySelectorAll(".ss-trip"))
        if (el !== line) el.remove();
      if (state.setup) setHtml(line, notice(state.setup, state.invalidated));
      else if (context.travel.hops == null)
        setHtml(line, "Distance in regions is not available yet.");
      else {
        const summary = snapshotSummary({
          books: state.cases?.books,
          avg: null,
        });
        const wooden = summary.rows[0];
        const fresh =
          !state.errors.cases &&
          freshness(state.cases?.at, TTL.cases) === "fresh";
        const rendered = tripLineHtml({
          hops: context.travel.hops,
          oilAsk: summary.oilAsk,
          oilAsks: state.cases?.books?.oil?.asks ?? [],
          sealedBid: quote(1, state.cases?.books?.woodenCase?.bids).value,
          openValue: wooden.complete ? wooden.openValue : null,
          roundTrip: state.settings.roundTrip,
          fresh,
          at: state.cases?.at,
        });
        setHtml(line, rendered.html);
        line.title = rendered.title;
      }
      nextRoots.push(context.travel.item.parentElement);
    } else for (const el of document.querySelectorAll(".ss-trip")) el.remove();
    observe(nextRoots);
    freshSignature = signature();
    metrics.scans++;
    metrics.scanMs += performance.now() - start;
    metrics.maxScanMs = Math.max(metrics.maxScanMs, performance.now() - start);
  }
  // The average item prices drive the verdict whenever the drop policy sells
  // any rarity (the default sells from epic), and the expanded details show
  // them even when it does not.
  const wantsAverages = () =>
    !state.settings.casesCollapsed || state.settings.sellFrom !== "never";
  async function fetchVisible() {
    if (state.setup || disposed || document.hidden) return;
    const jobs = [];
    const deskOpen = context.craft && !state.settings.craftCollapsed;
    if (context.equipment || deskOpen) jobs.push(read("book"));
    if (context.cases || context.travel || deskOpen) jobs.push(read("cases"));
    if (context.cases && wantsAverages()) jobs.push(read("avg"));
    await Promise.all(jobs);
  }
  async function tick() {
    if (disposed || ticking) return;
    ticking = true;
    if (!document.hidden) {
      applySettings(await send({ type: "getSettings" }));
      if (href !== location.href || Date.now() - lastScan > 30_000) {
        href = location.href;
        scan();
      }
      const nextSignature = signature();
      if (nextSignature !== freshSignature) {
        freshSignature = nextSignature;
        sched.schedule();
      }
      clock();
      void fetchVisible();
      if (context.craft && !state.settings.craftCollapsed) void refreshLedger();
    }
    ticking = false;
    if (!disposed) timer = setTimeout(tick, 5000);
  }
  const visible = () => {
    if (!document.hidden) {
      clearTimeout(timer);
      void tick();
    }
  };
  document.addEventListener("visibilitychange", visible);
  const dispose = () => {
    disposed = true;
    clearTimeout(timer);
    sched.cancel();
    observer.disconnect();
    equipment.clear();
    desk.clear();
    document.getElementById("scrap-sniper-cases")?.remove();
    for (const el of document.querySelectorAll(".ss-trip")) el.remove();
    document.removeEventListener("visibilitychange", visible);
  };
  await tick();
  metrics.equipment = equipment.metrics;
  return { dispose, metrics, scan };
}
