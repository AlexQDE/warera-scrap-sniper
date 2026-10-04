import { preferences, SELL_FROM } from "./lib/settings.mjs";
const $ = (id) => document.getElementById(id);
const toggles = [
  "equipment",
  "craft",
  "cases",
  "travel",
  "picker",
  "collapsed",
  "craftCollapsed",
  "casesCollapsed",
  "roundTrip",
];
const numbers = {
  margin: "minMarginPct",
  interval: "intervalSec",
  craftTargetPct: "craftTargetPct",
  craftBatch: "craftBatch",
};
function status(text, kind = "") {
  $("status").textContent = text;
  $("status").className = "status " + kind;
}
async function message(data) {
  const r = await chrome.runtime.sendMessage(data);
  if (!r) throw new Error("Extension did not answer. Reload its settings.");
  if (r.error && !["testKey"].includes(data.type))
    throw new Error(r.message ?? r.error);
  return r;
}
function show(p) {
  for (const [id, key] of Object.entries(numbers)) $(id).value = p[key];
  $("taxPct").value = p.taxPct ?? "";
  $("sellFrom").value = SELL_FROM.includes(p.sellFrom) ? p.sellFrom : "epic";
  for (const field of toggles) $(field).checked = p[field];
  const n = Object.keys(p.craftRecipes ?? {}).length;
  $("recipes").textContent = n
    ? `${n} craft recipe${n === 1 ? "" : "s"} stored on this browser.`
    : "No craft recipes stored.";
  $("forgetRecipes").disabled = n === 0;
}
async function load() {
  try {
    $("version").textContent = chrome.runtime.getManifest?.().version ?? "–";
  } catch {
    /* not inside the extension: keep the placeholder */
  }
  try {
    const r = await message({ type: "getSettings" });
    const p = preferences(r.settings);
    $("key").value = r.apiKey ?? "";
    show(p);
    status(
      r.rejected
        ? "API key rejected. Check the key, then Save to retry."
        : r.hasKey
          ? "Key saved on this browser. Test checks API acceptance."
          : "Add your WarEra API key to begin.",
    );
  } catch (e) {
    status(e.message, "bad");
  }
}
async function test() {
  $("test").disabled = true;
  try {
    status("Checking API key…");
    const r = await message({ type: "testKey", key: $("key").value.trim() });
    status(
      r.ok
        ? "Key accepted. Scrap bid: " + r.bid + " g."
        : (r.message ?? r.error),
      r.ok ? "ok" : "bad",
    );
  } catch (e) {
    status(e.message, "bad");
  } finally {
    $("test").disabled = false;
  }
}
async function save(event) {
  event.preventDefault();
  $("save").disabled = true;
  try {
    const patch = Object.fromEntries(
      toggles.map((field) => [field, $(field).checked]),
    );
    for (const [id, key] of Object.entries(numbers)) patch[key] = $(id).value;
    const r = await message({
      type: "saveSettings",
      settings: {
        ...patch,
        apiKey: $("key").value.trim(),
        taxPct: $("taxPct").value === "" ? null : $("taxPct").value,
        sellFrom: $("sellFrom").value,
      },
    });
    if (r.error) throw new Error(r.message);
    status("Saved. Open game tabs pick up changes within five seconds.", "ok");
    show(preferences(r.settings));
  } catch (e) {
    status(e.message, "bad");
  } finally {
    $("save").disabled = false;
  }
}
async function forgetRecipes() {
  $("forgetRecipes").disabled = true;
  try {
    const r = await message({
      type: "saveSettings",
      settings: { craftRecipes: {} },
    });
    show(preferences(r.settings));
    status("Craft recipes removed from this browser.", "ok");
  } catch (e) {
    status(e.message, "bad");
    $("forgetRecipes").disabled = false;
  }
}
$("settings").addEventListener("submit", save);
$("test").addEventListener("click", test);
$("forgetRecipes").addEventListener("click", forgetRecipes);
$("show").addEventListener("change", () => {
  $("key").type = $("show").checked ? "text" : "password";
});
load();
