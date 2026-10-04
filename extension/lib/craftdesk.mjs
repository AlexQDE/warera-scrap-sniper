// The Craft Desk: a compact panel under the equipment panel that works a
// craft through from the inputs to the listing, over the evidence at hand,
// and keeps the personal craft ledger. Rendering only: the maths live in
// craft.mjs and resale.mjs, the provenance in craftdata.mjs, the ledger
// rules in ledger.mjs. Every number on the desk names where it came from.
import { fmt, signed, escapeHtml as esc } from "./format.mjs";
import {
  setHtml,
  header,
  notice as noticeHtml,
  timeLabel,
  reaches,
} from "./ui.mjs";
import { nonNegative } from "./quality.mjs";
import {
  craftPlan,
  acquisition,
  proceeds,
  listingForProceeds,
  rankPlans,
  normalizeRecipe,
} from "./craft.mjs";
import {
  CRAFT_CODES,
  describeCode,
  inputPrices,
  taxRate,
  outcomesFor,
  normalizeRecipes,
} from "./craftdata.mjs";
import { listingScenarios, liquidity, MIN_RESALE_SAMPLE } from "./resale.mjs";
import {
  createEntry,
  transition,
  summarize,
  exportLedger,
  importLedger,
} from "./ledger.mjs";
import { RARITIES, SLOTS } from "./items.mjs";
import { itemLabel } from "./dom.mjs";

export const DESK_ID = "warera-plus-craft";
const SLOT_HEADS = ["weapon", ...SLOTS];
const LEDGER_ROWS = 20;
/** Ledger writes that must not overlap: each waits for the previous save. */
const LEDGER_WRITES = new Set([
  "desk-ledger-add",
  "desk-ledger-move",
  "desk-ledger-confirm",
  "desk-import-paste",
  "desk-import-file",
]);

const pct = (v, d = 0) => (v == null ? "–" : `${signed(v * 100, d)}%`);
/** The player's local calendar date, not the UTC one. */
const localDate = (iso) => new Date(iso).toLocaleDateString("en-CA");

/** Browser download of a text file; replaced in tests. */
function saveFile(name, text) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createCraftDesk({
  settings,
  save,
  onLedger,
  requestSales = () => {},
  refresh = () => {},
  rescan = () => {},
  now = Date.now,
  download = saveFile,
}) {
  /** Session-only inputs: typed prices, recipe fields, the open form. */
  let manual = {};
  let fields = {};
  let selected = null;
  let form = null; // the ledger entry being written, or null
  let pending = null; // { id, type } a ledger move waiting for its price
  let importOpen = false;
  let status = null; // one-line ledger feedback
  let lastState = null;
  let busy = false;
  const outcomesMemo = new Map(); // code|sales.at|tax -> outcomes
  const cellMemo = new Map(); // code -> { key, html, plan }

  function reset() {
    manual = {};
    fields = {};
    selected = null;
    form = null;
    pending = null;
    importOpen = false;
    status = null;
    cellMemo.clear();
  }
  function clear() {
    document.getElementById(DESK_ID)?.remove();
    reset();
  }
  const el = () => document.getElementById(DESK_ID);

  /** Save the ledger; true only when the worker confirmed the stored list. */
  /** Only what this tab changed travels: the entries it wrote and the ids it removed. */
  async function persist({ changed = [], removed = [] }, message) {
    if (busy) {
      status = "Ledger: a save is still running; try again in a moment";
      rescan();
      return false;
    }
    busy = true;
    rescan();
    let ok = false;
    try {
      // The base is the revision these rows were rendered from, never the newest the tab holds: a refresh may have
      // landed since, and an edit of a row rendered before another tab's deletion must still lose to it.
      const r = await onLedger({
        changed,
        removed,
        baseRevision: lastState?.ledger?.revision ?? 0,
      });
      if (r?.error) status = `Ledger: ${r.message ?? r.error}`;
      else if (!r?.ledger)
        status = "Ledger: not saved, the extension did not answer; try again";
      else {
        // The worker refuses an edit of an entry another tab deleted or changed since this tab last read; say so instead of claiming the move.
        const dropped = Array.isArray(r.dropped) ? r.dropped.length : 0;
        const conflicts = Array.isArray(r.conflicts) ? r.conflicts.length : 0;
        const lost = dropped + conflicts;
        const why =
          dropped && conflicts
            ? "deleted or changed in another tab meanwhile"
            : dropped
              ? "deleted in another tab meanwhile"
              : `changed in another tab meanwhile; ${lost === 1 ? "its" : "their"} current state is shown`;
        if (lost && lost >= changed.length + removed.length)
          status = `Ledger: not applied, ${lost === 1 ? "the entry was" : "the entries were"} ${why}`;
        else if (lost) status = `${message} · ${lost} not applied: ${why}`;
        else
          status = r.merged
            ? `${message} · merged with changes another tab made meanwhile`
            : message;
        ok = true;
      }
    } catch (e) {
      status = `Ledger: ${e?.message ?? "could not save"}`;
    }
    busy = false;
    rescan();
    return ok;
  }

  function onClick(e) {
    const t = e.target.closest("[data-action]");
    if (!t || !el()?.contains(t)) return;
    const a = t.dataset.action;
    if (busy && LEDGER_WRITES.has(a)) {
      // one save at a time, on every path that writes
      status = "Ledger: a save is still running; try again in a moment";
      rescan();
      return;
    }
    const s = settings();
    const entries = lastState?.ledger?.entries ?? [];
    const byId = (id) => entries.find((x) => x.id === id);
    if (a === "refresh") refresh();
    else if (a === "collapse") save({ craftCollapsed: !s.craftCollapsed });
    else if (a === "settings" || a === "reload") lastState?.action?.(a);
    else if (a === "desk-pick") {
      selected = t.dataset.code;
      delete fields["recipe-scraps"];
      delete fields["recipe-steel"];
      rescan();
    } else if (a === "desk-quotes") {
      manual = {};
      fields = {};
      rescan();
    } else if (a === "desk-save-recipe") {
      const r = normalizeRecipe({
        scraps: fields["recipe-scraps"],
        steel: fields["recipe-steel"],
      });
      if (!r || !selected) {
        status = "Recipe: enter whole numbers, at least one above zero";
        rescan();
        return;
      }
      const code = selected;
      const typed = {
        scraps: fields["recipe-scraps"],
        steel: fields["recipe-steel"],
      };
      // One code travels, not the whole table, so another tab's recipe is never overwritten; the inputs clear only once the worker confirmed,
      // and only while they still hold this save's numbers for this item: numbers typed meanwhile, for another item or this one, are not this save's to clear.
      Promise.resolve(save({ craftRecipeOps: { set: { [code]: r } } })).then(
        (applied) => {
          if (applied) {
            if (
              selected === code &&
              fields["recipe-scraps"] === typed.scraps &&
              fields["recipe-steel"] === typed.steel
            ) {
              delete fields["recipe-scraps"];
              delete fields["recipe-steel"];
            }
            status = `Recipe for ${itemLabel(code)} saved on this browser`;
          } else
            status =
              "Recipe: not saved, the extension did not answer; your numbers are kept, try again";
          rescan();
        },
        () => {
          status = "Recipe: not saved; your numbers are kept, try again";
          rescan();
        },
      );
    } else if (a === "desk-forget-recipe" && selected) {
      const code = selected;
      Promise.resolve(save({ craftRecipeOps: { remove: [code] } })).then(
        (applied) => {
          status = applied
            ? `Recipe for ${itemLabel(code)} removed`
            : "Recipe: not removed, the extension did not answer; try again";
          rescan();
        },
        () => {
          status = "Recipe: not removed; try again";
          rescan();
        },
      );
    } else if (a === "desk-ledger-new") {
      const p = inputPrices(lastState ?? {}, manual, now());
      form = {
        code: selected ?? "",
        scraps:
          fields["recipe-scraps"] ?? s.craftRecipes[selected]?.scraps ?? "",
        steel: fields["recipe-steel"] ?? s.craftRecipes[selected]?.steel ?? "",
        scrapPrice: p.scrap.value ?? "",
        steelPrice: p.steel.value ?? "",
        sources: { scrap: p.scrap.source, steel: p.steel.source },
        rarity: describeCode(selected)?.rarity ?? "",
        stat: "",
        durability: "100",
        note: "",
      };
      status = null;
      rescan();
    } else if (a === "desk-ledger-cancel") {
      form = null;
      rescan();
    } else if (a === "desk-ledger-add" && form) {
      const entry = createEntry(
        { ...form, priceSource: formPriceSource(form) },
        { now: now() },
      );
      if (!entry) {
        status = "Ledger: the craft needs whole input quantities";
        rescan();
        return;
      }
      const saving = form;
      void persist(
        { changed: [entry] },
        `Recorded ${entry.label || itemLabel(entry.code) || "a craft"} (${entry.inputs.priceSource} prices)`,
      ).then((ok) => {
        // A failed save keeps the form for another try; a form opened meanwhile is not this one's to close.
        if (ok && form === saving) form = null;
        rescan();
      });
    } else if (a === "desk-ledger-move") {
      const type = t.dataset.type;
      const entry = byId(t.dataset.id);
      if (!entry) return;
      if (type === "list" || type === "sell") {
        pending = { id: entry.id, type };
        fields["pending-price"] =
          type === "list" ? (entry.listing.price ?? "") : "";
        rescan();
        return;
      }
      if (type === "delete") {
        void persist({ removed: [entry.id] }, "Entry deleted");
        return;
      }
      const next = transition(entry, { type }, now());
      if (next)
        void persist(
          { changed: [next] },
          `Marked ${type === "unlist" ? "unlisted" : type === "keep" ? "kept" : "scrapped"}`,
        );
    } else if (a === "desk-ledger-confirm" && pending) {
      const entry = byId(pending.id);
      const price = nonNegative(fields["pending-price"]);
      const next =
        entry &&
        transition(
          entry,
          pending.type === "list"
            ? { type: "list", price }
            : { type: "sell", proceeds: price },
          now(),
        );
      if (!next) {
        status =
          pending.type === "sell"
            ? "Ledger: a sale needs the proceeds you received"
            : "Ledger: could not list this entry";
        rescan();
        return;
      }
      const done = pending.type;
      void persist(
        { changed: [next] },
        done === "sell"
          ? `Sale recorded: ${fmt(next.sale.proceeds)} g received`
          : `Listed at ${fmt(next.listing.price)} g`,
      ).then((ok) => {
        if (ok) pending = null;
        rescan();
      });
    } else if (a === "desk-ledger-pending-cancel") {
      pending = null;
      rescan();
    } else if (a === "desk-export") {
      download(
        `warera-plus-ledger-${localDate(new Date(now()).toISOString())}.json`,
        exportLedger(entries, now()),
      );
      status = `Exported ${entries.length} entries`;
      rescan();
    } else if (a === "desk-import-toggle") {
      importOpen = !importOpen;
      rescan();
    } else if (a === "desk-import-file") {
      el()?.querySelector("[data-field='import-file']")?.click();
    } else if (a === "desk-import-paste") {
      applyImport(fields["import-text"] ?? "");
    }
  }
  /** Manual only when every input the craft used was priced by hand; one quote-filled price makes the basis inferred. */
  function formPriceSource(f) {
    const used = [
      Number(f.scraps) > 0 ? f.sources?.scrap : null,
      Number(f.steel) > 0 ? f.sources?.steel : null,
    ].filter(Boolean);
    return used.length && used.every((src) => src === "manual")
      ? "manual"
      : "inferred";
  }
  function applyImport(text) {
    const entries = lastState?.ledger?.entries ?? [];
    const r = importLedger(text, entries, now());
    if (r.error) {
      status = `Import failed: ${r.error}`;
      rescan();
      return;
    }
    // Only the entries the file added or updated are written; the rest stays as stored.
    const existing = new Map(entries.map((e) => [e.id, e]));
    const changed = r.entries.filter((e) => {
      const old = existing.get(e.id);
      return !old || old.updatedAt !== e.updatedAt;
    });
    void persist(
      { changed },
      `Imported: ${r.added} added, ${r.updated} updated, ${r.skipped} skipped`,
    ).then((ok) => {
      if (ok) {
        importOpen = false;
        delete fields["import-text"];
      }
      rescan();
    });
  }
  function onInput(e) {
    const f = e.target?.dataset?.field;
    if (!f || !el()?.contains(e.target)) return;
    fields[f] = e.target.value;
    if (form && f.startsWith("form-")) form[f.slice(5)] = e.target.value;
  }
  function onChange(e) {
    const f = e.target?.dataset?.field;
    if (!f || !el()?.contains(e.target)) return;
    const v = e.target.value;
    if (f === "scrapPrice" || f === "steelPrice") {
      manual = { ...manual, [f]: v === "" ? undefined : v };
      delete fields[f];
      rescan();
    } else if (f === "batch" || f === "taxPct" || f === "targetPct") {
      // Settings own these once saved; the typed text shadows them only until the save is confirmed.
      fields[f] = v;
      const patch =
        f === "batch"
          ? { craftBatch: v }
          : f === "taxPct"
            ? { taxPct: v === "" ? null : v }
            : { craftTargetPct: v };
      Promise.resolve(save(patch)).then(
        (applied) => {
          // Text typed since this value was committed is a newer edit, not yet saved: it is not this save's to clear.
          if (applied) {
            if (fields[f] === v) delete fields[f];
          } else
            status =
              "Settings: not saved, the extension did not answer; try again";
          rescan();
        },
        () => {
          status = "Settings: not saved; try again";
          rescan();
        },
      );
    } else if (f === "import-file") {
      if (busy) return;
      const file = e.target.files?.[0];
      if (!file) return;
      file.text().then(applyImport, () => {
        status = "Import failed: could not read the file";
        rescan();
      });
    } else if (form && f.startsWith("form-")) {
      form[f.slice(5)] = v;
      if (f === "form-scrapPrice") form.sources.scrap = "manual";
      if (f === "form-steelPrice") form.sources.steel = "manual";
      rescan();
    } else rescan();
  }
  function mount(anchor, after = false) {
    let desk = el();
    if (!desk) {
      desk = document.createElement("section");
      desk.id = DESK_ID;
      desk.dataset.lens = "";
      desk.addEventListener("click", onClick);
      desk.addEventListener("input", onInput);
      desk.addEventListener("change", onChange);
      anchor.insertAdjacentElement(after ? "afterend" : "beforebegin", desk);
    } else if (
      after
        ? !reaches(anchor.nextElementSibling, desk)
        : !reaches(desk.nextElementSibling, anchor)
    )
      anchor.insertAdjacentElement(after ? "afterend" : "beforebegin", desk);
    return desk;
  }
  const field = (name, value, attrs = "") =>
    `<input data-field="${name}" value="${esc(fields[name] ?? value ?? "")}" ${attrs}>`;
  const numberField = (name, value, step = "0.001", extra = "") =>
    field(
      name,
      value,
      `type="number" inputmode="decimal" min="0" step="${step}" ${extra}`,
    );

  function cellText(plan, inputs) {
    if (!inputs.recipe.value)
      return { text: "no recipe", title: inputs.recipe.note };
    if (plan.ev.status === "ok" && plan.ev.roi != null)
      return {
        text: pct(plan.ev.roi),
        title: `expected profit ${signed(plan.ev.profit)} g per craft, ${inputs.outcomes.note}`,
      };
    if (plan.cost.total == null)
      return {
        text: "no price",
        title: `missing: ${plan.cost.missing.join(", ")}`,
      };
    if (!inputs.outcomes.outcomes.length)
      return {
        text: inputs.outcomes.estimate
          ? `${inputs.outcomes.estimate.n}/${MIN_RESALE_SAMPLE} fills`
          : "no fills",
        title: inputs.outcomes.note,
      };
    return { text: "–", title: plan.ev.reason ?? "unavailable" };
  }

  /** The outcomes of crafting `code`, memoised per sales snapshot and tax rate. */
  function outcomesOf(code, state, tax) {
    const sales = state.salesByCode?.[code];
    // The window is measured from now, so a cached estimate turns over every five minutes and fills age out of it.
    const key = `${code}|${sales?.at ?? ""}|${tax.value}|${Math.floor(now() / 300_000)}`;
    let o = outcomesMemo.get(key);
    if (!o) {
      const outcomes = outcomesFor(code, {
        salesByCode: state.salesByCode,
        now: now(),
      });
      o = {
        outcomes,
        outcomeList: outcomes.outcomes.map((x) => ({
          label: x.label,
          p: x.p,
          proceeds:
            x.listing == null
              ? null
              : proceeds({ listing: x.listing, taxPct: tax.value }).sellerGets,
        })),
      };
      if (outcomesMemo.size > 200) outcomesMemo.clear();
      outcomesMemo.set(key, o);
    }
    return o;
  }
  function buildInputs(code, state, recipes, tax) {
    return {
      item: describeCode(code),
      recipe: recipes[code]
        ? { value: recipes[code], source: "manual" }
        : { value: null, source: "none", note: "recipe not entered" },
      ...outcomesOf(code, state, tax),
    };
  }
  function planFor(code, state, s, recipes, tax, prices) {
    const inputs = buildInputs(code, state, recipes, tax);
    const recipe = inputs.recipe.value;
    const plan = recipe
      ? craftPlan({
          recipe,
          batch: s.craftBatch,
          scrapPrice: prices.scrap.value,
          steelPrice: prices.steel.value,
          outcomes: inputs.outcomeList,
          targetMarginPct: s.craftTargetPct,
        })
      : null;
    return { inputs, recipe, plan };
  }

  function detailHtml(code, state, s, tax, prices, recipes) {
    const { inputs, recipe, plan } = planFor(
      code,
      state,
      s,
      recipes,
      tax,
      prices,
    );
    const item = inputs.item;
    const rs = fields["recipe-scraps"] ?? recipe?.scraps ?? "";
    const rst = fields["recipe-steel"] ?? recipe?.steel ?? "";
    const out = [];
    out.push(
      `<h3>${esc(itemLabel(code))} <small>tier ${item?.tier ?? "?"} ${esc(item?.slot ?? "")}</small></h3>`,
      `<div class="lens-recipe"><label>Scraps <input data-field="recipe-scraps" type="number" inputmode="numeric" min="0" step="1" value="${esc(rs)}"></label><label>Steel <input data-field="recipe-steel" type="number" inputmode="numeric" min="0" step="1" value="${esc(rst)}"></label><button type="button" data-action="desk-save-recipe">Save recipe</button>${recipe ? '<button type="button" data-action="desk-forget-recipe">Forget</button>' : ""}<small>${recipe ? "your recipe, stored on this browser" : "not entered: read it off the game's craft screen; nothing is assumed"}</small></div>`,
    );
    if (!recipe || !plan) {
      out.push(
        `<p class="lens-muted">Cost, EV and ceilings need the recipe.</p>`,
      );
      return out.join("");
    }
    const acq = acquisition({
      recipe,
      batch: s.craftBatch,
      scrapBook: prices.scrap.book,
      steelBook: prices.steel.book,
    });
    const b = plan.batch.size;
    out.push(
      `<div class="lens-grid2"><div><small>Per craft</small><b>${fmt(plan.cost.perCraft)} g</b><span>${recipe.scraps} scraps × ${fmt(prices.scrap.value)} + ${recipe.steel} steel × ${fmt(prices.steel.value)}</span></div><div><small>Batch of ${b}</small><b>${fmt(plan.batch.cost)} g</b><span>${plan.cost.scraps} scraps + ${plan.cost.steel} steel · ${esc(prices.scrap.note)} · ${esc(prices.steel.note)}</span></div></div>`,
    );
    const immediate = acq.immediate.total;
    const bidTotal = acq.bid.total;
    out.push(
      `<div class="lens-grid2"><div><small>Buy now at the asks</small><b>${immediate == null ? "–" : `${fmt(immediate)} g`}</b><span>${acq.immediate.complete ? "walked through the observed ask depth for the whole batch" : `observed asks do not cover ${acq.immediate.missing.join(" and ") || "the batch"}: no immediate price`}</span></div><div><small>Place bids at the best bid</small><b>${bidTotal == null ? "–" : `${fmt(bidTotal)} g`}</b><span>${bidTotal == null ? `no resting bid to join for ${acq.bid.missing.join(", ")}` : `${acq.bid.frontTotal != null ? `${fmt(acq.bid.frontTotal)} g one tick ahead of the queue · ` : ""}fills only when a seller comes down to it, maybe never; ${immediate != null ? `saves ${fmt(immediate - bidTotal)} g against buying now if it does` : "the saving against buying now is unknown"}`}</span></div></div>`,
    );
    const ev = plan.ev;
    const o = inputs.outcomes;
    const evLine =
      ev.status === "ok"
        ? `<b>${fmt(ev.ev)} g</b><span>seller proceeds after ${tax.value}% tax · ${esc(o.note)}${ev.cost != null ? ` · ${Math.round((ev.pProfit ?? 0) * 100)}% of outcomes beat the cost` : ""}${o.outcomes.length > 1 ? ` · best ${fmt(ev.best)} · worst ${fmt(ev.worst)}` : ""}</span>`
        : `<b>unavailable</b><span>${esc(ev.reason ?? o.note)}</span>`;
    out.push(
      `<div class="lens-grid2"><div><small>Expected proceeds per craft</small>${evLine}</div><div><small>Expected profit</small><b class="${ev.profit == null ? "" : ev.profit >= 0 ? "lens-pos" : "lens-neg"}">${ev.profit == null ? "–" : `${signed(ev.profit)} g`}</b><span>ROI ${pct(ev.roi, 1)} per craft · batch ${plan.batch.expectedProfit == null ? "–" : `${signed(plan.batch.expectedProfit)} g`} · an expectation over random outcomes, not a promise</span></div></div>`,
    );
    const ceiling = (c) =>
      c.value == null ? `– (${esc(c.reason)})` : `${fmt(c.value)} g`;
    out.push(
      `<div class="lens-grid2"><div><small>Break-even ceilings</small><b>scraps ≤ ${ceiling(plan.breakEven.maxScrapPrice)}</b><span>at steel ${fmt(prices.steel.value)} g · steel ≤ ${ceiling(plan.breakEven.maxSteelPrice)} at scraps ${fmt(prices.scrap.value)} g · prices snapped down to the 0.001 tick</span></div><div><small>For ${s.craftTargetPct}% ROI</small><b>scraps ≤ ${ceiling(plan.target.maxScrapPrice)}</b><span>steel ≤ ${ceiling(plan.target.maxSteelPrice)} · the most an input may cost for the expected result to return the target</span></div></div>`,
    );
    const est = o.estimate;
    const scenarios = est ? listingScenarios(est) : {};
    const breakEvenListing =
      plan.cost.perCraft == null
        ? null
        : listingForProceeds({
            sellerGets: plan.cost.perCraft,
            taxPct: tax.value,
          });
    const breakEvenLine =
      breakEvenListing == null
        ? ""
        : `<p class="lens-muted">Break-even listing <b>${fmt(breakEvenListing)} g</b>: the lowest listing that nets your cost of ${fmt(plan.cost.perCraft)} g per craft at ${tax.value}% tax, snapped up to the tick.</p>`;
    if (est?.status === "ok") {
      const sales = state.salesByCode?.[code];
      const liq = o.fills?.length ? liquidity(o.fills, { now: now() }) : null;
      const row = (name, sc) =>
        sc
          ? `<div><small>${name}</small><b>${fmt(sc.price)} g</b><span>nets ${fmt(proceeds({ listing: sc.price, taxPct: tax.value }).sellerGets)} g after tax · ${esc(sc.basis)}</span></div>`
          : `<div><small>${name}</small><b>–</b><span>needs 8 comparable fills (${est.n} now)</span></div>`;
      out.push(
        `<h4>Listing guidance <small>listing = the price shown on the market; "nets" = what you keep at ${tax.value}% tax (${esc(tax.source === "none" ? "no rate read" : tax.source === "page" ? "rate read off the page" : "your rate")})</small></h4><div class="lens-grid3">${row("Quick sale", scenarios.quick)}${row("Balanced", scenarios.balanced)}${row("Patient", scenarios.patient)}</div><p class="lens-muted">Evidence: ${est.n} comparable fills in ${est.windowHours} h${est.capped ? " (capped sample)" : ""} · low ${fmt(est.low)} · high ${fmt(est.high)}${est.uncertaintyPct != null ? ` · ±${est.uncertaintyPct.toFixed(0)}% spread (MAD)` : ""} · last fill ${timeLabel(est.lastAt, now())}${liq?.medianGapHours != null ? ` · pace ${liq.perDay.toFixed(1)}/day, median gap ${liq.medianGapHours.toFixed(1)} h (recent pace, not your queue)` : ""}${sales ? ` · read ${timeLabel(sales.at, now())}` : ""}</p>${breakEvenLine}`,
      );
    } else
      out.push(
        `<h4>Listing guidance</h4><p class="lens-muted">${est ? `${est.n} of ${MIN_RESALE_SAMPLE} comparable fills in ${est.windowHours} h: no scenario yet` : esc(o.note)}.</p>${breakEvenLine}`,
      );
    out.push(
      `<p><button type="button" data-action="desk-ledger-new">Record a craft of this</button></p>`,
    );
    return out.join("");
  }
  function ledgerHtml(state, tax) {
    const ledger = state.ledger;
    if (!ledger)
      return `<h3>Craft ledger</h3><p class="lens-muted">Loading your ledger…</p>`;
    const entries = ledger.entries;
    const estimateFor = (code) => {
      const o = code ? outcomesOf(code, state, tax).outcomes : null;
      return o?.estimate?.status === "ok" ? o.estimate.estimate : null;
    };
    const sum = summarize(entries, { estimateFor });
    const out = [
      `<h3>Craft ledger <small>${entries.length} ${entries.length === 1 ? "entry" : "entries"} · manual record; nothing is observed automatically</small></h3>`,
    ];
    out.push(
      `<div class="lens-grid3"><div><small>Realized (sold)</small><b class="${sum.sold.realized >= 0 ? "lens-pos" : "lens-neg"}">${signed(sum.sold.realized)} g</b><span>${sum.sold.n} sold · ${fmt(sum.sold.proceeds)} g received${sum.sold.unknownCost ? ` · ${sum.sold.unknownCost} without a cost basis` : ""}</span></div><div><small>Open pieces</small><b>${sum.open.n}</b><span>cost basis ${fmt(sum.open.cost)} g${sum.open.unknownCost ? ` (${sum.open.unknownCost} unknown)` : ""}</span></div><div><small>Estimated value of open pieces</small><b>${sum.open.covered ? `${fmt(sum.open.estimated)} g` : "–"}</b><span>${sum.open.covered} of ${sum.open.n} with a comparable-sales estimate · an estimate, not realized profit</span></div></div>`,
    );
    if (status)
      out.push(`<p class="lens-notice" role="status">${esc(status)}</p>`);
    const dis = busy ? "disabled" : "";
    if (form) {
      const sel = (name, options, value) =>
        `<select data-field="${name}">${options.map((o) => `<option value="${esc(o)}" ${o === value ? "selected" : ""}>${esc(o || "–")}</option>`).join("")}</select>`;
      const source = formPriceSource(form);
      out.push(
        `<div class="lens-form"><label>Item ${sel("form-code", ["", ...CRAFT_CODES], form.code)}</label><label>Scraps used <input data-field="form-scraps" type="number" min="0" step="1" value="${esc(form.scraps)}"></label><label>Steel used <input data-field="form-steel" type="number" min="0" step="1" value="${esc(form.steel)}"></label><label>Scrap price <input data-field="form-scrapPrice" type="number" min="0" step="0.001" value="${esc(form.scrapPrice)}"></label><label>Steel price <input data-field="form-steelPrice" type="number" min="0" step="0.001" value="${esc(form.steelPrice)}"></label><label>Result rarity ${sel("form-rarity", ["", ...RARITIES], form.rarity)}</label><label>Stat <input data-field="form-stat" type="number" min="0" step="1" value="${esc(form.stat)}"></label><label>Durability % <input data-field="form-durability" type="number" min="0" max="100" step="1" value="${esc(form.durability)}"></label><label class="lens-wide">Note <input data-field="form-note" maxlength="120" value="${esc(form.note)}"></label><p class="lens-muted lens-wide">Prices are <b>${source}</b>: ${source === "inferred" ? "at least one used price was filled from the quotes of this moment; edit it to what you really paid" : "every used price was typed by you"}.</p><div class="lens-wide"><button type="button" data-action="desk-ledger-add" ${dis}>Add to ledger</button> <button type="button" data-action="desk-ledger-cancel">Cancel</button></div></div>`,
      );
    }
    const rows = entries.slice(0, LEDGER_ROWS).map((e) => {
      const name = e.label || itemLabel(e.code) || "craft";
      const basis =
        e.costBasis == null
          ? "cost basis unknown"
          : `basis ${fmt(e.costBasis)} g (${e.inputs.priceSource})`;
      const result = [
        e.result.rarity,
        e.result.stat != null ? `stat ${e.result.stat}` : null,
        e.result.durability != null ? `${e.result.durability}%` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const money =
        e.state === "sold"
          ? `sold for ${fmt(e.sale.proceeds)} g${e.costBasis != null ? ` · realized <b class="${e.sale.proceeds - e.costBasis >= 0 ? "lens-pos" : "lens-neg"}">${signed(e.sale.proceeds - e.costBasis)} g</b>` : " · realized unknown (no basis)"}`
          : e.state === "listed"
            ? `listed at ${fmt(e.listing.price)} g · unsold: nothing realized`
            : e.state;
      const isPending = pending?.id === e.id;
      const actions = isPending
        ? `<label>${pending.type === "sell" ? "Proceeds received" : "Listing price"} <input data-field="pending-price" type="number" min="0" step="0.001" value="${esc(fields["pending-price"] ?? "")}"></label><button type="button" data-action="desk-ledger-confirm" ${dis}>Confirm</button><button type="button" data-action="desk-ledger-pending-cancel">Cancel</button>`
        : e.state === "crafted"
          ? move(e.id, "list", "List…") +
            move(e.id, "sell", "Sold…") +
            move(e.id, "keep", "Keep") +
            move(e.id, "scrap", "Scrap")
          : e.state === "listed"
            ? move(e.id, "sell", "Sold…") + move(e.id, "unlist", "Unlist")
            : move(e.id, "delete", "Delete");
      return `<li><div><b>${esc(name)}</b> <small>${esc(result)}</small><br><small>${localDate(e.createdAt)} · ${e.inputs.scraps} scraps + ${e.inputs.steel} steel · ${basis} · ${money}</small></div><div class="lens-actions">${actions}</div></li>`;
    });
    out.push(
      rows.length
        ? `<ul class="lens-ledger">${rows.join("")}</ul>${entries.length > LEDGER_ROWS ? `<p class="lens-muted">${entries.length - LEDGER_ROWS} older entries are kept and exported, not listed here.</p>` : ""}`
        : `<p class="lens-muted">No crafts recorded yet. Record one from an item above, or import a file.</p>`,
    );
    out.push(
      `<div class="lens-actions">${form ? "" : '<button type="button" data-action="desk-ledger-new">Record a craft</button>'}<button type="button" data-action="desk-export" ${entries.length ? "" : "disabled"}>Export JSON</button><button type="button" data-action="desk-import-toggle" aria-expanded="${importOpen}">Import…</button></div>${importOpen ? `<div class="lens-form"><div class="lens-wide"><button type="button" data-action="desk-import-file" ${dis}>Choose a file</button><input data-field="import-file" type="file" accept="application/json,.json" hidden> or paste an export:</div><textarea data-field="import-text" class="lens-wide" rows="3">${esc(fields["import-text"] ?? "")}</textarea><div class="lens-wide"><button type="button" data-action="desk-import-paste" ${dis}>Import pasted</button></div><p class="lens-muted lens-wide">Entries are merged by id; the newer copy wins; malformed entries are skipped and counted.</p></div>` : ""}`,
    );
    return out.join("");
  }
  const move = (id, type, label) =>
    `<button type="button" data-action="desk-ledger-move" data-type="${type}" data-id="${esc(id)}" ${busy ? "disabled" : ""}>${label}</button>`;

  function render(state, anchor, { after = false } = {}) {
    lastState = state;
    if (!anchor) {
      clear();
      return null;
    }
    const desk = mount(anchor, after);
    const s = settings();
    if (state.setup) {
      setHtml(
        desk,
        header("Craft Desk", { status: "setup", collapse: false }) +
          noticeHtml(state.setup, state.invalidated),
      );
      return { roots: [desk.parentElement] };
    }
    const prices = inputPrices(state, manual, now());
    const tax = taxRate({ settings: s.taxPct, page: state.taxOnPage });
    const anyQuote = prices.scrap.value != null || prices.steel.value != null;
    const statusText = state.busy
      ? "loading"
      : !anyQuote
        ? "loading"
        : prices.scrap.fresh &&
            (prices.steel.fresh || prices.steel.source === "none")
          ? "fresh"
          : "stale";
    const head = header("Craft Desk", {
      at: state.cases?.at ?? state.book?.at,
      now: now(),
      status: statusText,
      collapsed: s.craftCollapsed,
      busy: !!state.busy,
    });
    if (s.craftCollapsed) {
      setHtml(
        desk,
        head +
          `<p class="lens-muted">Compare crafting by tier and slot, buy now against placed bids, break-even ceilings, listing guidance and your craft ledger. Open Details.</p>`,
      );
      return { roots: [desk.parentElement] };
    }
    if (selected) requestSales(selected);
    const recipes = normalizeRecipes(s.craftRecipes);
    const ranked = [];
    const matrix = RARITIES.map((rarity, i) => {
      const cells = SLOT_HEADS.map((slot) => {
        const code = slot === "weapon" ? CRAFT_CODES[i * 6] : `${slot}${i + 1}`;
        const recipe = recipes[code];
        // One cell is rebuilt only when something it shows changed.
        const key = [
          Math.floor(now() / 300_000),
          state.salesByCode?.[code]?.at ?? "",
          prices.scrap.value,
          prices.steel.value,
          tax.value,
          recipe?.scraps ?? "",
          recipe?.steel ?? "",
          s.craftBatch,
          s.craftTargetPct,
          selected === code,
        ].join("|");
        let cell = cellMemo.get(code);
        if (!cell || cell.key !== key) {
          const { inputs, plan } = planFor(
            code,
            state,
            s,
            recipes,
            tax,
            prices,
          );
          const c = plan
            ? cellText(plan, inputs)
            : { text: "no recipe", title: inputs.recipe.note };
          const cls =
            plan?.ev.status === "ok" && plan.ev.roi != null
              ? plan.ev.roi >= 0
                ? "lens-pos"
                : "lens-neg"
              : "lens-muted";
          cell = {
            key,
            plan,
            html: `<td><button type="button" data-action="desk-pick" data-code="${code}" aria-pressed="${selected === code}" title="${esc(c.title)}" class="${cls}">${esc(c.text)}</button></td>`,
          };
          cellMemo.set(code, cell);
        }
        if (cell.plan) ranked.push({ code, plan: cell.plan });
        return cell.html;
      });
      return `<tr><th scope="row">${rarity}</th>${cells.join("")}</tr>`;
    });
    const recipeCount = Object.keys(recipes).length;
    const top = rankPlans(ranked)[0];
    const best =
      top?.plan.ev.roi != null
        ? ` · best ${esc(itemLabel(top.code))} ${pct(top.plan.ev.roi)}`
        : "";
    const html =
      head +
      `<div class="lens-desk"><div class="lens-inputs"><label>Scrap price ${numberField("scrapPrice", manual.scrapPrice ?? prices.scrap.value ?? "")}<small>${esc(prices.scrap.note)}</small></label><label>Steel price ${numberField("steelPrice", manual.steelPrice ?? prices.steel.value ?? "")}<small>${esc(prices.steel.note)}</small></label><label>Batch ${numberField("batch", s.craftBatch, "1", 'max="1000" inputmode="numeric"')}<small>crafts</small></label><label>Market tax % ${numberField("taxPct", s.taxPct ?? (tax.source === "page" ? tax.value : ""), "0.01", 'max="100" placeholder="' + esc(tax.source === "page" ? `${tax.value} (page)` : "0") + '"')}<small>${esc(tax.source === "manual" ? "your rate" : tax.source === "page" ? "read off the page notice" : "none read: proceeds = listing")}</small></label><label>Target ROI % ${numberField("targetPct", s.craftTargetPct, "1", 'min="-50" max="500"')}<small>for the ceilings</small></label><button type="button" data-action="desk-quotes">Use quotes</button></div>` +
      `<table class="lens-matrix"><caption>Expected ROI by tier and slot${recipeCount ? ` · ${recipeCount} of 36 recipes entered${best}` : " · no recipes entered yet: pick a cell and enter its recipe"}</caption><thead><tr><th>Tier</th>${SLOT_HEADS.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${matrix.join("")}</tbody></table>` +
      `<section class="lens-detail">${selected ? detailHtml(selected, state, s, tax, prices, recipes) : '<p class="lens-muted">Pick a cell to work a craft through: recipe, cost, buying now or bidding, expected value over its outcomes, break-even ceilings and listing guidance.</p>'}</section>` +
      `<section class="lens-ledger-box">${ledgerHtml(state, tax)}</section>` +
      `<p class="lens-muted">Read-only decision support: nothing is bought, crafted or listed for you. Input prices are the best asks (buying now) unless you type your own; expected values weight every outcome by its probability; comparable sales are the last 72 h of fills for the same item. Recipes are yours to verify against the game.</p></div>`;
    setHtml(desk, html);
    return { roots: [desk.parentElement] };
  }
  return {
    render,
    clear,
    reset,
    get selected() {
      return selected;
    },
    select: (code) => {
      selected = code;
    },
  };
}
