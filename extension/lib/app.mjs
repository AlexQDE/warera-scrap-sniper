import * as dom from "./dom.mjs";
import { DEFAULTS } from "./settings.mjs";
import { TTL, freshness, quote } from "./quality.mjs";
import { snapshotSummary } from "./cases.mjs";
import { createEquipment } from "./equipment.mjs";
import { createCraftDesk } from "./craftdesk.mjs";
import { createDialogs } from "./dialogs.mjs";
import { casesStripHtml, tripLineHtml } from "./casesview.mjs";
import { mountBar, headHtml, BAR_ID } from "./panel.mjs";
import { panel, setHtml, notice, clock } from "./ui.mjs";
import { createScheduler } from "./scheduler.mjs";

const ON_EQUIPMENTS = /^\/market\/equipments\/?$/;

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
    taxOnPage: null,
    history: null, // where the worker's history of the player stands (count, since when, filled to the start or not)
    ledger: null, // the worker's view of that history: results by activity and window, recent pieces, last craft and opening
    craftsUserId: null, // the id it is read for: the setting, else the page's own-profile links
    selectedCode: null, // the item selected in the market grid
    errors: {},
    busy: new Set(),
  };
  const SALES_CODES_KEPT = 36;
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
    // Sales are fresh per item: the rows' item and the ledger's items each keep their own read.
    const held = kind === "sales" ? state.salesByCode[code] : state[kind];
    // A recorded read error ends a snapshot's exemption: a refresh that failed over a still-fresh cached read is
    // retried after the window below, so the warning clears on its own once a read succeeds.
    const failed = kind === "sales" && !!state.salesErrors?.[code];
    if (
      !force &&
      !failed &&
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
          // Keep the last few items' fills so rows of other codes keep their value evidence.
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
      // The reads kept while this one ran go first, each with its force flag; the grid's item is asked for
      // afterwards only when nothing is being read or waiting for it, so one refresh makes one read.
      drainSales();
      if (
        salesWanted &&
        salesWanted !== code &&
        !state.busy.has("sales") &&
        !salesPending.has(salesWanted)
      )
        void read("sales", false, salesWanted);
    }
  }
  /** Run the sales reads kept while one was in flight, one at a time; the rest wait for the next completion. */
  function drainSales() {
    if (!context.equipment && !context.craft && !context.dialog) {
      salesPending.clear();
      return;
    }
    for (const [pendingCode, forced] of [...salesPending]) {
      salesPending.delete(pendingCode);
      void read("sales", forced, pendingCode);
      if (state.busy.has("sales")) return;
    }
  }
  const requestSales = (code) => {
    if (context.equipment || context.craft || context.dialog)
      void read("sales", false, code);
  };
  const equipment = createEquipment({
    settings: () => state.settings,
    // The grid's item first, then every other item on the page: each row is valued by the sales of its own stats.
    requestSales: (code, others = []) => {
      salesWanted = code ?? salesWanted;
      if (code) requestSales(code);
      for (const other of others) if (other !== code) requestSales(other);
    },
    rescan: () => sched.schedule(),
  });
  const desk = createCraftDesk({ settings: () => state.settings });
  // ---- the player's history: filled from the start of the profile, polled, viewed ----
  let historyBusy = false;
  let historyAgain = false;
  let fastUntil = 0;
  const ledgerAsked = { rev: -1, window: "", at: 0 };
  /** One history step in the worker (it decides whether a poll or a backfill page is due), then the view when it changed. */
  async function syncHistory(force = false) {
    const userId = state.craftsUserId;
    if (!userId || state.setup || disposed || document.hidden) return;
    if (historyBusy) {
      if (force) historyAgain = true;
      return;
    }
    historyBusy = true;
    state.busy.add("history");
    const r = await send({
      type: "history",
      userId,
      force,
      fast: Date.now() < fastUntil || !!context.dialog,
    });
    state.busy.delete("history");
    if (r?.history && r.history.userId === state.craftsUserId)
      state.history = r.history;
    if (r)
      state.errors.history =
        r.error && r.error !== "superseded" ? r.message : null;
    const window = desk.window;
    const wanted =
      state.settings.panel === "ledger" || !!context.dialog || context.craft;
    if (
      wanted &&
      state.history &&
      (state.history.rev !== ledgerAsked.rev ||
        window !== ledgerAsked.window ||
        Date.now() - ledgerAsked.at > 30_000)
    ) {
      const v = await send({ type: "ledger", userId, window });
      if (v?.ledger && v.ledger.meta?.userId === state.craftsUserId) {
        state.ledger = v.ledger;
        ledgerAsked.rev = v.ledger.meta.rev;
        ledgerAsked.window = window;
        ledgerAsked.at = Date.now();
        for (const code of v.ledger.salesWanted ?? []) requestSales(code);
      }
    }
    historyBusy = false;
    sched.schedule();
    if (historyAgain) {
      historyAgain = false;
      void syncHistory(true);
    }
  }
  /** A click on the game's own craft or open button: the result is read a moment later, twice, and polled fast for a while. */
  const dialogs = createDialogs({
    onAction: () => {
      fastUntil = Date.now() + 120_000;
      setTimeout(() => void syncHistory(true), 2500);
      setTimeout(() => void syncHistory(true), 7000);
    },
  });
  /** The bar's own controls: the tabs, refresh, and the desk's buttons. */
  function onBarClick(e) {
    const t = e.target.closest("[data-action]");
    if (!t) return;
    const name = t.dataset.action;
    if (name === "tab") {
      const tab = t.dataset.tab;
      void save({ panel: state.settings.panel === tab ? "none" : tab });
    } else if (name === "refresh") {
      const open = state.settings.panel;
      void read("book", true);
      if (context.equipment || open === "craft") void read("avg", true);
      if (open === "craft") void read("cases", true);
      if (salesWanted) void read("sales", true, salesWanted);
      if (state.craftsUserId) void syncHistory(true);
      sched.schedule();
    } else if (name === "settings" || name === "reload") action(name);
    else if (desk.onClick(e)) {
      ledgerAsked.at = 0;
      sched.schedule();
      void syncHistory();
    }
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
  function removeBar() {
    document.getElementById(BAR_ID)?.remove();
    equipment.clear();
    desk.clear();
  }
  function scan() {
    if (disposed || document.hidden) return;
    const start = performance.now();
    lastScan = Date.now();
    // Whose history: the id set in settings, else the one the page's own-profile links carry. Another account's is never shown.
    const userId = state.settings.craft
      ? (state.settings.userId ?? dom.ownUserId())
      : null;
    if (userId !== state.craftsUserId) {
      state.craftsUserId = userId;
      state.history = null;
      state.ledger = null;
      ledgerAsked.rev = -1;
    }
    const onEquipments = ON_EQUIPMENTS.test(location.pathname);
    context = {
      equipment: state.settings.equipment && onEquipments,
      craft: state.settings.craft && onEquipments,
      dialog: null,
    };
    const nextRoots = [];
    const anchor =
      context.equipment || context.craft ? dom.marketAnchor() : null;
    if (anchor) {
      const open = state.settings.panel;
      const scanned = context.equipment
        ? equipment.render({
            ...state,
            error: state.errors.book,
            salesErrors: state.salesErrors,
            salesReading: state.salesReading,
            busy: state.busy.has("book"),
          })
        : null;
      if (scanned) nextRoots.push(...scanned.roots);
      else equipment.clear();
      state.selectedCode =
        scanned?.code ??
        dom.selectedItemCode() ??
        dom.filteredItemCode(location.search);
      const dialog = context.equipment ? dom.pickerDialog() : null;
      if (dialog) nextRoots.push(dialog);
      if (context.craft) {
        state.taxOnPage = dom.taxRateFromText(dom.taxNotice()?.textContent);
      }
      const { bar, head, body } = mountBar(anchor, onBarClick);
      const book = state.book;
      const fresh =
        !state.errors.book &&
        freshness(book?.at, state.settings.intervalSec * 1000) === "fresh";
      const tabs = [
        ...(context.equipment ? ["market"] : []),
        ...(context.craft ? ["craft", "ledger"] : []),
      ];
      const section = tabs.includes(open) ? open : "none";
      setHtml(
        head,
        headHtml({
          at: book?.at,
          status: state.setup
            ? "setup"
            : !book && state.busy.has("book")
              ? "loading"
              : fresh
                ? "fresh"
                : "stale",
          busy: state.busy.has("book") || state.busy.has("history"),
          panel: section,
          tabs,
          pulse: [
            context.equipment ? equipment.pulse() : "",
            context.craft ? desk.pulse(state) : "",
          ]
            .filter(Boolean)
            .join(" · "),
          setup: !!state.setup,
        }),
      );
      if (state.setup) {
        body.hidden = false;
        setHtml(body, notice(state.setup, state.invalidated));
      } else if (section === "none") {
        body.hidden = true;
        setHtml(body, "");
      } else {
        body.hidden = false;
        if (section === "market")
          equipment.renderMarket(body, {
            ...state,
            error: state.errors.book,
          });
        else
          desk.render(
            body,
            {
              ...state,
              historyError: state.errors.history ?? null,
              historyBusy: state.busy.has("history"),
            },
            section,
          );
      }
      nextRoots.push(bar.parentElement);
    } else removeBar();
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
    // The game's case and craft dialogs, wherever they open.
    const shown =
      state.settings.craft && !state.setup
        ? dialogs.render({ ...state, now: Date.now() })
        : (dialogs.clear(), null);
    context.dialog = shown?.kind ?? null;
    if (shown?.root) nextRoots.push(shown.root);
    observe(nextRoots);
    freshSignature = signature();
    metrics.scans++;
    metrics.scanMs += performance.now() - start;
    metrics.maxScanMs = Math.max(metrics.maxScanMs, performance.now() - start);
  }
  // The average item prices drive the case verdict whenever the drop policy
  // sells any rarity (the default sells from epic), and the expanded details
  // show them even when it does not.
  const wantsAverages = () =>
    !state.settings.casesCollapsed || state.settings.sellFrom !== "never";
  async function fetchVisible() {
    if (state.setup || disposed || document.hidden) return;
    const jobs = [];
    const open = state.settings.panel;
    const craftOpen = (context.craft && open === "craft") || !!context.dialog;
    if (context.equipment || craftOpen || (context.craft && open === "market"))
      jobs.push(read("book"));
    if (context.cases || context.travel || craftOpen) jobs.push(read("cases"));
    // Every row is valued at the game's average until its item's fills are read; the craft board is built from them.
    if (context.equipment || craftOpen || (context.cases && wantsAverages()))
      jobs.push(read("avg"));
    if (state.craftsUserId) jobs.push(syncHistory());
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
    }
    ticking = false;
    if (!disposed) timer = setTimeout(tick, 5000);
  }
  const visible = () => {
    if (!document.hidden) {
      clearTimeout(timer);
      drainSales(); // reads kept while the tab was hidden go first, with their force flags
      void tick();
    }
  };
  document.addEventListener("visibilitychange", visible);
  const dispose = () => {
    disposed = true;
    clearTimeout(timer);
    sched.cancel();
    observer.disconnect();
    removeBar();
    dialogs.dispose();
    document.getElementById("scrap-sniper-cases")?.remove();
    for (const el of document.querySelectorAll(".ss-trip")) el.remove();
    document.removeEventListener("visibilitychange", visible);
  };
  await tick();
  metrics.equipment = equipment.metrics;
  return { dispose, metrics, scan };
}
