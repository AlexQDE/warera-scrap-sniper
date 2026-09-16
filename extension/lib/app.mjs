import * as dom from "./dom.mjs";
import { DEFAULTS } from "./settings.mjs";
import { TTL, freshness, quote } from "./quality.mjs";
import { snapshotSummary } from "./cases.mjs";
import { createEquipment } from "./equipment.mjs";
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
    errors: {},
    busy: new Set(),
  };
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
        state.setup = "WarEra Lens was updated. Reload this page.";
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
        state.errors = {};
        state.rejected = false;
      }
      sched.schedule();
    }
    if (r.rejected) state.rejected = true;
    state.setup = state.invalidated
      ? "WarEra Lens was updated. Reload this page."
      : state.rejected
        ? "API key rejected. Check and save your key in settings."
        : r.hasKey
          ? null
          : "Add your WarEra API key in extension settings.";
    if (previousSetup !== state.setup) sched.schedule();
  }
  const save = async (patch) => {
    applySettings(await send({ type: "saveSettings", settings: patch }));
    scan();
    void fetchVisible();
  };
  async function read(kind, force = false, code) {
    if (
      disposed ||
      document.hidden ||
      state.setup ||
      state.invalidated ||
      state.busy.has(kind)
    )
      return;
    const ttl = kind === "book" ? state.settings.intervalSec * 1000 : TTL[kind];
    if (
      !force &&
      !Object.keys(state[kind]?.failures ?? {}).length &&
      freshness(state[kind]?.at, ttl) === "fresh" &&
      (kind !== "sales" || state.sales?.code === code)
    )
      return;
    state.busy.add(kind);
    const revision = state.authRevision;
    const r = await send({
      type: kind,
      force,
      ...(code ? { itemCode: code } : {}),
    });
    state.busy.delete(kind);
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
      } else {
        if (r[kind]) state[kind] = r[kind];
        state.errors[kind] = r.error ? r.message : null;
      }
    }
    sched.schedule();
    if (
      kind === "sales" &&
      salesWanted &&
      salesWanted !== code &&
      !document.hidden
    )
      void read("sales", false, salesWanted);
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
  });
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
        busy: state.busy.has("book"),
        action,
      });
      if (result) nextRoots.push(...result.roots);
      const dialog = dom.pickerDialog();
      if (dialog) nextRoots.push(dialog);
    } else if (before.equipment) equipment.clear();
    const onCases =
      /^\/market\/?$/.test(location.pathname) ||
      /\/inventory\/?$/.test(location.pathname);
    context.cases = state.settings.cases && onCases ? dom.casesAnchor() : null;
    if (context.cases) {
      const strip = panel("scrap-sniper-cases", context.cases, (e) => {
        const name = e.target.closest("[data-action]")?.dataset.action;
        if (name === "refresh") {
          void read("cases", true);
          if (!state.settings.casesCollapsed) void read("avg", true);
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
  async function fetchVisible() {
    if (state.setup || disposed || document.hidden) return;
    const jobs = [];
    if (context.equipment) jobs.push(read("book"));
    if (context.cases || context.travel) jobs.push(read("cases"));
    if (context.cases && !state.settings.casesCollapsed) jobs.push(read("avg"));
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
    document.getElementById("scrap-sniper-cases")?.remove();
    for (const el of document.querySelectorAll(".ss-trip")) el.remove();
    document.removeEventListener("visibilitychange", visible);
  };
  await tick();
  return { dispose, metrics, scan };
}
