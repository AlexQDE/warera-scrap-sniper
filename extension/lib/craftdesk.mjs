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
  rerollFloor,
} from "./craft.mjs";
import {
  CRAFT_CODES,
  describeCode,
  inputPrices,
  taxRate,
  outcomesFor,
  normalizeRecipes,
  recipeFor,
  randomCraft,
  GAME_RECIPES,
} from "./craftdata.mjs";
import { listingScenarios, liquidity, MIN_RESALE_SAMPLE } from "./resale.mjs";
import {
  createEntry,
  transition,
  summarize,
  exportLedger,
  importLedger,
  MAX_ENTRIES,
} from "./ledger.mjs";
import { RARITIES, SLOTS } from "./items.mjs";
import { itemLabel } from "./dom.mjs";
import {
  replayCrafts,
  rollValue,
  craftsSummary,
  dayOf,
  MIN_ROLL_SAMPLE,
  COUNTED_FROM,
} from "./observed.mjs";

export const DESK_ID = "warera-plus-craft";
const SLOT_HEADS = ["weapon", ...SLOTS];
/**
 * Which side of a sale the market tax lands on. In the game it is the
 * BUYER's, at the buyer's own country's rate, paid to that country; the
 * seller receives the listed price either way, and since 2026-09-09 the
 * price a buyer sees already includes it ("All prices displayed include a 1%
 * market tax from your country"). So a listing is what the seller nets, and
 * the rate only changes what a buyer in your country is shown.
 * docs/GAME-FACTS.md §5.
 */
const TAX_MODE = "added";
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
  let craftWindow = "today"; // the window of the player's own crafts shown: today (UTC) or 7 days
  const outcomesMemo = new Map(); // code|sales.at|tax -> outcomes
  const cellMemo = new Map(); // code -> { key, html, plan }
  const replayMemo = { key: "", entries: [] }; // the player's feed replayed, per read and steel mode

  function reset() {
    manual = {};
    fields = {};
    selected = null;
    form = null;
    pending = null;
    importOpen = false;
    status = null;
    craftWindow = "today";
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
        // The worker refuses an edit of an entry another tab deleted or changed since this tab last read, and takes
        // no new entry into a full ledger; say so instead of claiming the move.
        const dropped = Array.isArray(r.dropped) ? r.dropped.length : 0;
        const conflicts = Array.isArray(r.conflicts) ? r.conflicts.length : 0;
        const capped = Array.isArray(r.capped) ? r.capped.length : 0;
        const lost = dropped + conflicts + capped;
        const why = [
          dropped ? "deleted in another tab meanwhile" : "",
          conflicts
            ? `changed in another tab meanwhile; ${conflicts === 1 ? "its" : "their"} current state is shown`
            : "",
          capped
            ? `not kept: the ledger is full (${MAX_ENTRIES} entries), export it and delete old entries`
            : "",
        ]
          .filter(Boolean)
          .join(" · ");
        if (lost && lost >= changed.length + removed.length)
          status =
            capped === lost
              ? `Ledger: ${capped === 1 ? "the entry was not kept" : `${capped} entries were not kept`}, the ledger is full (${MAX_ENTRIES} entries); export it and delete old entries`
              : `Ledger: not applied, ${lost === 1 ? "the entry was" : "the entries were"} ${why}`;
        else if (lost) status = `${message} · ${lost} not applied: ${why}`;
        else
          status = r.merged
            ? `${message} · merged with changes another tab made meanwhile`
            : message;
        // A write the ledger could not hold in full is not done: the form or the pasted import stays for another try once there is room.
        ok = !capped;
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
    } else if (a === "desk-window") {
      craftWindow = t.dataset.window === "7d" ? "7d" : "today";
      rescan();
    } else if (a === "desk-quotes") {
      // Back to the market's prices: only the typed scrap and steel prices go; a recipe, a pending price or a pasted import being entered stays.
      manual = {};
      delete fields.scrapPrice;
      delete fields.steelPrice;
      rescan();
    } else if (a === "desk-save-recipe") {
      // The boxes show the recipe in use (the game's, or the override), so a box left untouched means that number, not zero.
      const shown = selected
        ? recipeFor(selected, normalizeRecipes(s.craftRecipes)).value
        : null;
      const r = normalizeRecipe({
        scraps: fields["recipe-scraps"] ?? shown?.scraps,
        steel: fields["recipe-steel"] ?? shown?.steel,
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
      const game = GAME_RECIPES[code];
      if (game && r.scraps === game.scraps && r.steel === game.steel) {
        // Nothing to override: the game's table already says this. An override that now matches it goes instead.
        delete fields["recipe-scraps"];
        delete fields["recipe-steel"];
        if (!normalizeRecipes(s.craftRecipes)[code]) {
          status = `Recipe for ${itemLabel(code)}: that is the game's recipe already; nothing to override`;
          rescan();
          return;
        }
        Promise.resolve(save({ craftRecipeOps: { remove: [code] } })).then(
          (applied) => {
            status = applied
              ? `Recipe for ${itemLabel(code)} matches the game's table again; the override is removed`
              : "Recipe: not saved, the extension did not answer; try again";
            rescan();
          },
          () => {
            status = "Recipe: not saved; try again";
            rescan();
          },
        );
        return;
      }
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
            ? `Recipe override for ${itemLabel(code)} removed; the game's recipe applies`
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
      const used = recipeFor(selected ?? "", normalizeRecipes(s.craftRecipes));
      form = {
        code: selected ?? "",
        scraps: fields["recipe-scraps"] ?? used.value?.scraps ?? "",
        steel: fields["recipe-steel"] ?? used.value?.steel ?? "",
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
            : "Ledger: a listing needs its price";
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
        text: `${pct(plan.ev.roi)}${inputs.outcomes.error ? " ⚠" : ""}`,
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
          ? `${inputs.outcomes.estimate.n}/${MIN_RESALE_SAMPLE} fills${inputs.outcomes.error ? " ⚠" : ""}`
          : inputs.outcomes.error
            ? "read failed"
            : "no fills",
        title: inputs.outcomes.note,
      };
    return { text: "–", title: plan.ev.reason ?? "unavailable" };
  }

  /** The outcomes of crafting `code`, memoised per sales snapshot and tax rate. */
  function outcomesOf(code, state, tax) {
    const sales = state.salesByCode?.[code];
    const error = state.salesErrors?.[code] ?? null;
    // The window is measured from now, so a cached estimate turns over every five minutes and fills age out of it.
    const key = `${code}|${sales?.at ?? ""}|${error ?? ""}|${tax.value}|${Math.floor(now() / 300_000)}`;
    let o = outcomesMemo.get(key);
    if (!o) {
      const read = outcomesFor(code, {
        salesByCode: state.salesByCode,
        now: now(),
      });
      // A refresh that failed leaves the last good read in place: still the evidence, but said to be that, as the panel does.
      const outcomes = error
        ? {
            ...read,
            error,
            note: sales
              ? `${read.note} · last read failed (${error}); showing the last good read`
              : `sales read failed: ${error}`,
          }
        : { ...read, error: null };
      o = {
        outcomes,
        outcomeList: outcomes.outcomes.map((x) => ({
          label: x.label,
          p: x.p,
          proceeds:
            x.listing == null
              ? null
              : proceeds({
                  listing: x.listing,
                  taxPct: tax.value,
                  mode: TAX_MODE,
                }).sellerGets,
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
      // The player's override first, else the game's own recipe: no cell is ever empty.
      recipe: recipeFor(code, recipes),
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
  /**
   * The random craft of a tier: half the steel, the slot picked by the game,
   * one outcome per slot valued at that slot's sales-weighted listing. The
   * game's table applies whatever the player overrode per cell.
   */
  function randomPlanFor(tier, state, s, tax, prices) {
    const random = randomCraft(tier, (code) => {
      const o = outcomesOf(code, state, tax).outcomes;
      return o.estimate?.status === "ok" ? o.estimate.estimate : null;
    });
    if (!random) return null;
    const plan = craftPlan({
      recipe: random.recipe,
      batch: s.craftBatch,
      scrapPrice: prices.scrap.value,
      steelPrice: prices.steel.value,
      outcomes: random.outcomes.map((o) => ({
        label: o.label,
        p: o.p,
        proceeds:
          o.listing == null
            ? null
            : proceeds({
                listing: o.listing,
                taxPct: tax.value,
                mode: TAX_MODE,
              }).sellerGets,
      })),
      targetMarginPct: s.craftTargetPct,
    });
    return { random, plan };
  }
  const RANDOM_ODDS_TEXT =
    "the game picks the slot: 30% weapon, 14% each armour slot";
  function randomCellHtml(rp) {
    if (!rp)
      return `<td class="lens-random lens-muted" title="no random craft for this tier">–</td>`;
    const { random, plan } = rp;
    const title = `random craft: ${random.recipe.scraps} scraps + ${random.recipe.steel} steel (half the chosen-slot steel); ${RANDOM_ODDS_TEXT}; ${random.covered} of 6 slots have a sales estimate`;
    if (plan.ev.status === "ok" && plan.ev.roi != null)
      return `<td class="lens-random ${plan.ev.roi >= 0 ? "lens-pos" : "lens-neg"}" title="${esc(title)} · expected profit ${signed(plan.ev.profit)} g per craft">${esc(pct(plan.ev.roi))}</td>`;
    if (plan.cost.total == null)
      return `<td class="lens-random lens-muted" title="${esc(title)} · missing: ${esc(plan.cost.missing.join(", "))}">no price</td>`;
    return `<td class="lens-random lens-muted" title="${esc(title)}">${random.covered}/6 slots</td>`;
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
      `<div class="lens-recipe"><label>Scraps <input data-field="recipe-scraps" type="number" inputmode="numeric" min="0" step="1" value="${esc(rs)}"></label><label>Steel <input data-field="recipe-steel" type="number" inputmode="numeric" min="0" step="1" value="${esc(rst)}"></label><button type="button" data-action="desk-save-recipe">Save recipe</button>${inputs.recipe.source === "manual" ? '<button type="button" data-action="desk-forget-recipe">Forget override</button>' : ""}<small>${esc(inputs.recipe.note)}${inputs.recipe.source === "game" ? "; type other numbers to override it if the game's craft screen disagrees" : ""}</small></div>`,
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
    // A bad roll dismantled at once gives the tier's scraps back; only the steel is gone.
    const floor = rerollFloor({
      rarity: item?.rarity ?? "",
      recipe,
      cost: plan.cost.perCraft,
      scrapBid: prices.scrap.book?.bid ?? prices.scrap.book?.bids?.[0]?.price,
      steelPrice: prices.steel.value,
    });
    if (floor.scrapsBack != null)
      out.push(
        `<p class="lens-muted">Reroll floor: a crafted piece is at 100%, and dismantling it returns all <b>${floor.scrapsBack} scraps</b>${floor.scrapsValue != null ? ` (${fmt(floor.scrapsValue)} g at the ${fmt(prices.scrap.book?.bid ?? prices.scrap.book?.bids?.[0]?.price)} scrap bid)` : " (no scrap bid to value them at)"}; the ${floor.steelLost} steel is gone${floor.steelCost != null ? ` (${fmt(floor.steelCost)} g)` : ""}. ${floor.loss != null ? `A roll you send straight back to scraps costs <b>${fmt(floor.loss)} g</b>, not the ${fmt(plan.cost.perCraft)} g input.` : "The loss on a roll sent back to scraps needs the scrap bid."}</p>`,
      );
    const immediate = acq.immediate.total;
    const bidTotal = acq.bid.total;
    out.push(
      `<div class="lens-grid2"><div><small>Buy now at the asks</small><b>${immediate == null ? "–" : `${fmt(immediate)} g`}</b><span>${acq.immediate.complete ? "walked through the observed ask depth for the whole batch" : `observed asks do not cover ${acq.immediate.missing.join(" and ") || "the batch"}: no immediate price`}</span></div><div><small>Place bids at the best bid</small><b>${bidTotal == null ? "–" : `${fmt(bidTotal)} g`}</b><span>${bidTotal == null ? `no resting bid to join for ${acq.bid.missing.join(", ")}` : `${acq.bid.frontTotal != null ? `${fmt(acq.bid.frontTotal)} g one tick ahead of the queue · ` : ""}fills only when a seller comes down to it, maybe never; ${immediate != null ? `saves ${fmt(immediate - bidTotal)} g against buying now if it does` : "the saving against buying now is unknown"}`}</span></div></div>`,
    );
    const ev = plan.ev;
    const o = inputs.outcomes;
    // How often the result would have beaten the cost: over the outcomes when there is a real distribution, over the
    // comparable fills themselves when the only outcome is their median (a one-outcome model can only say 0% or 100%).
    const beat =
      o.outcomes.length > 1 && ev.cost != null
        ? ` · ${Math.round((ev.pProfit ?? 0) * 100)}% of outcomes beat the cost`
        : o.fills?.length && plan.cost.perCraft != null
          ? ` · ${o.fills.filter((f) => proceeds({ listing: f.price, taxPct: tax.value, mode: TAX_MODE }).sellerGets > plan.cost.perCraft).length} of the ${o.fills.length} comparable fills would have beaten the cost (fill prices taken as the sellers' listings)`
          : "";
    const evLine =
      ev.status === "ok"
        ? `<b>${fmt(ev.ev)} g</b><span>what the seller nets: the listing itself, the market tax being the buyer's · ${esc(o.note)}${beat}${o.outcomes.length > 1 ? ` · best ${fmt(ev.best)} · worst ${fmt(ev.worst)}` : ""}</span>`
        : `<b>unavailable</b><span>${esc(ev.reason ? `${ev.reason}${o.error ? ` · ${o.note}` : ""}` : o.note)}</span>`;
    out.push(
      `<div class="lens-grid2"><div><small>Expected proceeds per craft</small>${evLine}</div><div><small>Expected profit</small><b class="${ev.profit == null ? "" : ev.profit >= 0 ? "lens-pos" : "lens-neg"}">${ev.profit == null ? "–" : `${signed(ev.profit)} g`}</b><span>ROI ${pct(ev.roi, 1)} per craft · batch ${plan.batch.expectedProfit == null ? "–" : `${signed(plan.batch.expectedProfit)} g`} · an expectation over random outcomes, not a promise</span></div></div>`,
    );
    // The same tier crafted at random, for the comparison the game's craft menu invites.
    const rp = item?.tier
      ? randomPlanFor(item.tier, state, s, tax, prices)
      : null;
    if (rp)
      out.push(
        `<p class="lens-muted">Random craft of this tier instead: ${rp.random.recipe.scraps} scraps + ${rp.random.recipe.steel} steel = ${rp.plan.cost.perCraft == null ? "no price" : `${fmt(rp.plan.cost.perCraft)} g`}; ${RANDOM_ODDS_TEXT}. ${rp.plan.ev.status === "ok" ? `Expected ${fmt(rp.plan.ev.ev)} g, ROI ${pct(rp.plan.ev.roi, 1)} over the six slots' estimates` : `EV unavailable: ${rp.random.covered} of 6 slots have a sales estimate`}.</p>`,
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
            mode: TAX_MODE,
          });
    const breakEvenLine =
      breakEvenListing == null
        ? ""
        : `<p class="lens-muted">Break-even listing <b>${fmt(breakEvenListing)} g</b>: the lowest listing that returns your cost of ${fmt(plan.cost.perCraft)} g per craft, snapped up to the tick; the seller keeps the listing, the tax is the buyer's.</p>`;
    if (est?.status === "ok") {
      const sales = state.salesByCode?.[code];
      const liq = o.fills?.length ? liquidity(o.fills, { now: now() }) : null;
      const row = (name, sc) =>
        sc
          ? `<div><small>${name}</small><b>${fmt(sc.price)} g</b><span>a buyer in a ${tax.value}% country is shown ${fmt(proceeds({ listing: sc.price, taxPct: tax.value, mode: TAX_MODE }).buyerPays)} g · ${esc(sc.basis)}</span></div>`
          : `<div><small>${name}</small><b>–</b><span>needs 8 comparable fills (${est.n} now)</span></div>`;
      out.push(
        `<h4>Listing guidance <small>listing = the price you set and keep; buyers see it plus their own country's market tax (${tax.value}% ${esc(tax.source === "none" ? "assumed, no rate read" : tax.source === "page" ? "read off the page notice" : "your rate")})</small></h4><div class="lens-grid3">${row("Quick sale", scenarios.quick)}${row("Balanced", scenarios.balanced)}${row("Patient", scenarios.patient)}</div><p class="lens-muted">Evidence: ${est.n} comparable fills in ${est.windowHours} h${est.capped ? " (capped sample)" : ""} · low ${fmt(est.low)} · high ${fmt(est.high)}${est.uncertaintyPct != null ? ` · ±${est.uncertaintyPct.toFixed(0)}% spread (MAD)` : ""} · last fill ${timeLabel(est.lastAt, now())}${liq?.medianGapHours != null ? ` · pace ${liq.perDay.toFixed(1)}/day, median gap ${liq.medianGapHours.toFixed(1)} h (recent pace, not your queue)` : ""}${sales ? ` · read ${timeLabel(sales.at, now())}` : ""}${o.error ? ` · <b>last read failed</b> (${esc(o.error)}): the last good read is shown` : ""}</p>${breakEvenLine}`,
      );
    } else
      out.push(
        `<h4>Listing guidance</h4><p class="lens-muted">${est ? `${est.n} of ${MIN_RESALE_SAMPLE} comparable fills in ${est.windowHours} h: no scenario yet${o.error ? ` · <b>last read failed</b> (${esc(o.error)}): the last good read is shown` : ""}` : esc(o.note)}.</p>${breakEvenLine}`,
      );
    out.push(
      `<p><button type="button" data-action="desk-ledger-new">Record a craft of this</button></p>`,
    );
    return out.join("");
  }
  /** Words for the stat keys on the crafts table. */
  const STAT_WORDS = {
    attack: "attack",
    criticalChance: "crit chance",
    criticalDamages: "crit damage",
    armor: "armor",
    precision: "precision",
    dodge: "dodge",
  };
  /**
   * The player's own crafts of the window, replayed from the feed the worker
   * read: cost at the craft day's averages, fate by item id, held pieces at
   * what their roll clears at. The headline words mirror the community
   * ledger's so the two can be compared side by side.
   */
  function ownCraftsHtml(state, s) {
    const id = state.craftsUserId ?? null;
    const c = state.crafts;
    const box = (sub, body) =>
      `<section class="lens-own"><h3>Your crafts <small>${sub}</small></h3>${body}</section>`;
    if (!id)
      return box(
        "account not found on this page",
        `<p class="lens-muted">The page did not show your own inventory or skills link, so your crafts cannot be read. Set your player id in the extension's Advanced settings (the 24 characters in your profile URL).</p>`,
      );
    if (!c || c.userId !== id)
      return box(
        state.craftsError ? "read failed" : "reading…",
        `<p class="lens-muted">${state.craftsError ? `Your crafts could not be read: ${esc(state.craftsError)}. Refresh retries.` : "Reading your crafts, sales and dismantles of the last 7 days from the game's feed."}</p>`,
      );
    const key = `${c.at}|${c.userId}|${s.craftSteelMode}`;
    if (replayMemo.key !== key) {
      replayMemo.key = key;
      replayMemo.entries = replayCrafts({
        crafts: c.crafts,
        sales: c.sales,
        dismantles: c.dismantles,
        me: c.userId,
        averages: c.averages,
        steelMode: s.craftSteelMode,
      }).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    }
    const entries = replayMemo.entries;
    const today = dayOf(new Date(now()).toISOString());
    const from =
      craftWindow === "7d"
        ? dayOf(new Date(now() - 6 * 86400e3).toISOString())
        : today;
    const valueOf = (e) =>
      rollValue(e.code, e.skills, state.salesByCode?.[e.code]?.fills ?? []);
    const sum = craftsSummary(entries, { from, to: today, valueOf });
    const shown = entries.filter((e) => e.day >= from && e.day <= today);
    // The sales that price the held pieces, asked for one item at a time as the panel's are.
    const want = [
      ...new Set(
        shown
          .filter(
            (e) =>
              e.fate === "held" &&
              RARITIES.indexOf(String(e.rarity)) >= COUNTED_FROM,
          )
          .map((e) => e.code),
      ),
    ].slice(0, 8);
    for (const code of want)
      if (!state.salesByCode?.[code] && !state.salesErrors?.[code])
        requestSales(code);
    const unrealizedCls =
      sum.unrealized == null
        ? ""
        : sum.unrealized >= 0
          ? "lens-pos"
          : "lens-neg";
    const realizedCls = !sum.goneKnown
      ? ""
      : sum.realized >= 0
        ? "lens-pos"
        : "lens-neg";
    const windowWord = craftWindow === "7d" ? "7 days" : "today";
    const tiles = `<div class="lens-grid3"><div><small>Crafting · ${windowWord}</small><b class="${realizedCls}">${sum.goneKnown ? `${signed(sum.realized)} g` : "–"}</b><span>${sum.goneKnown ? `realized on ${sum.sold + sum.scrapped} gone (${sum.sold} sold, ${sum.scrapped} scrapped)${sum.realizedPct != null ? ` · ${pct(sum.realizedPct, 1)}` : ""}` : `${sum.crafted} crafted — ${sum.held} still yours, not counted here`}${sum.below ? ` · ${sum.below} below epic not counted` : ""}</span></div><div><small>Net value</small><b class="${unrealizedCls}">${sum.unrealized != null ? `${signed(sum.unrealized)} g` : "–"}</b><span>${sum.held ? `${sum.covered === sum.held ? fmt(sum.atMarket) : `${fmt(sum.atMarket)} (${sum.covered} of ${sum.held} priced)`} g at market against ${fmt(sum.heldCost)} g of inputs, ${sum.held} held unsold` : "nothing held"}</span></div><div><small>Crafted ${windowWord}</small><b>${sum.crafted}</b><span>${sum.counted} counted (epic and up) · ${sum.held} held · ${sum.sold} sold · ${sum.scrapped} scrapped</span></div></div>`;
    const rows = shown.slice(0, 40).map((e) => {
      const v = e.fate === "held" ? valueOf(e) : null;
      const stat =
        e.stat && e.skills?.[e.stat] != null
          ? `${STAT_WORDS[e.stat] ?? e.stat} ${e.skills[e.stat]}${e.slot === "weapon" && e.skills.attack != null ? ` · attack ${e.skills.attack}` : ""}`
          : "roll unknown";
      const worth =
        e.fate === "sold"
          ? `sold ${fmt(e.proceeds)} g`
          : e.fate === "scrapped"
            ? `scrapped${e.proceeds != null ? `: ${fmt(e.proceeds)} g in scraps` : ""}`
            : v?.value != null
              ? `clears ${fmt(v.value)} g <small>${v.level === "roll" ? `${v.n} sales of this roll` : v.level === "band" ? `${v.n} sales at ${v.band?.lo}–${v.band?.hi}` : `${v.n} sales of the item, any roll`}</small>`
              : `<small>${state.salesErrors?.[e.code] ? "sales read failed" : state.salesByCode?.[e.code] ? `needs ${MIN_ROLL_SAMPLE} recent sales` : "reading sales…"}</small>`;
      const pnl =
        e.cost == null
          ? null
          : e.fate === "held"
            ? v?.value == null
              ? null
              : v.value - e.cost
            : e.proceeds == null
              ? null
              : e.proceeds - e.cost;
      const cls = pnl == null ? "" : pnl >= 0 ? "lens-pos" : "lens-neg";
      const when = new Date(e.at);
      const time = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
      return `<tr><td>${craftWindow === "7d" ? `${esc(localDate(e.at))} ` : ""}${time}</td><td>${esc(itemLabel(e.code))}</td><td>${esc(stat)}</td><td class="lens-num">${e.cost == null ? "–" : fmt(e.cost)}</td><td>${worth}</td><td class="lens-num ${cls}">${pnl == null ? "–" : signed(pnl)}</td></tr>`;
    });
    const covered =
      c.complete?.crafts && c.complete?.sales && c.complete?.dismantles;
    const who = c.username
      ? esc(c.username)
      : `player …${esc(String(id).slice(-6))}`;
    return box(
      `${who} · ${c.days} days of your feed · read ${timeLabel(c.at, now())}${state.craftsBusy ? " · refreshing" : ""}`,
      `<div class="lens-windows"><button type="button" data-action="desk-window" data-window="today" aria-pressed="${craftWindow !== "7d"}">Today</button><button type="button" data-action="desk-window" data-window="7d" aria-pressed="${craftWindow === "7d"}">7 days</button></div>${tiles}${rows.length ? `<table class="lens-crafts"><thead><tr><th>When</th><th>Item</th><th>Roll</th><th>Cost</th><th>Now</th><th>P&amp;L</th></tr></thead><tbody>${rows.join("")}</tbody></table>${shown.length > 40 ? `<p class="lens-muted">${shown.length - 40} more not listed.</p>` : ""}` : `<p class="lens-muted">No crafts of yours ${craftWindow === "7d" ? "in the last 7 days" : "today (UTC)"} in the feed.</p>`}<p class="lens-muted">Cost = the recipe at the craft day's average scrap and steel prices (${s.craftSteelMode === "chosen" ? "chosen-slot steel, twice the fee" : "random-craft steel fee"}; change it in settings) · "clears" = the median of recent sales of the same roll, else of its band, else of the item · fates joined to your sales and dismantles by item id · days are UTC${covered ? "" : " · the feed was not fully covered (page cap), older rows may be missing"}.</p>`,
    );
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
          `<p class="lens-muted">Your own crafts replayed from the feed (cost, what each roll clears at, profit or loss), crafting by tier and slot, buy now against placed bids, break-even ceilings, listing guidance and your craft ledger. Open Details.</p>`,
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
          state.salesErrors?.[code] ?? "",
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
      // The seventh column: the tier crafted at random (not a pick: it is no single item to read sales for or to record).
      const randomCell = randomCellHtml(
        randomPlanFor(i + 1, state, s, tax, prices),
      );
      return `<tr><th scope="row">${rarity}</th>${cells.join("")}${randomCell}</tr>`;
    });
    const overrides = Object.keys(recipes).length;
    const top = rankPlans(ranked)[0];
    const best =
      top?.plan.ev.roi != null
        ? ` · best ${esc(itemLabel(top.code))} ${pct(top.plan.ev.roi)}`
        : "";
    const html =
      head +
      `<div class="lens-desk">${ownCraftsHtml(state, s)}<div class="lens-inputs"><label>Scrap price ${numberField("scrapPrice", manual.scrapPrice ?? prices.scrap.value ?? "")}<small>${esc(prices.scrap.note)}</small></label><label>Steel price ${numberField("steelPrice", manual.steelPrice ?? prices.steel.value ?? "")}<small>${esc(prices.steel.note)}</small></label><label>Batch ${numberField("batch", s.craftBatch, "1", 'max="1000" inputmode="numeric"')}<small>crafts</small></label><label>Market tax % ${numberField("taxPct", s.taxPct ?? (tax.source === "page" ? tax.value : ""), "0.01", 'max="100" placeholder="' + esc(tax.source === "page" ? `${tax.value} (page)` : "0") + '"')}<small>${esc(tax.source === "manual" ? "your rate (the buyer's, by country)" : tax.source === "page" ? "read off the page notice" : "none read; the tax is the buyer's, so the listing is what you keep")}</small></label><label>Target ROI % ${numberField("targetPct", s.craftTargetPct, "1", 'min="-50" max="500"')}<small>for the ceilings</small></label><button type="button" data-action="desk-quotes">Use quotes</button></div>` +
      `<table class="lens-matrix"><caption>Expected ROI by tier and slot · the game's recipes, slot chosen${overrides ? ` (${overrides} overridden by you)` : ""}; random = the game picks the slot at half the steel${best}</caption><thead><tr><th>Tier</th>${SLOT_HEADS.map((h) => `<th>${h}</th>`).join("")}<th title="${esc(RANDOM_ODDS_TEXT)}">random</th></tr></thead><tbody>${matrix.join("")}</tbody></table>` +
      `<section class="lens-detail">${selected ? detailHtml(selected, state, s, tax, prices, recipes) : '<p class="lens-muted">Pick a cell to work a craft through: recipe, cost, buying now or bidding, expected value over its outcomes, break-even ceilings and listing guidance.</p>'}</section>` +
      `<section class="lens-ledger-box">${ledgerHtml(state, tax)}</section>` +
      `<p class="lens-muted">Read-only decision support: nothing is bought, crafted or listed for you. Input prices are the best asks (buying now) unless you type your own; expected values weight every outcome by its probability; comparable sales are the last 72 h of fills for the same item. Recipes are the game's table (the tier's scrap value in scraps, the steel fee doubled for a chosen slot); override a cell from the game's craft screen if it disagrees.</p></div>`;
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
