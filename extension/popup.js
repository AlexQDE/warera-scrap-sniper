import { preferences, SELL_FROM } from "./lib/settings.mjs";
const $ = (id) => document.getElementById(id);
const toggles = [
  "equipment",
  "craft",
  "cases",
  "travel",
  "picker",
  "casesCollapsed",
  "roundTrip",
];
const numbers = {
  margin: "minMarginPct",
  flipPct: "flipPct",
  interval: "intervalSec",
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
  $("sellFrom").value = SELL_FROM.includes(p.sellFrom) ? p.sellFrom : "epic";
  $("userId").value = p.userId ?? "";
  $("craftSteelMode").value = p.craftSteelMode ?? "random";
  for (const field of toggles) $(field).checked = p[field];
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
        sellFrom: $("sellFrom").value,
        userId: $("userId").value.trim() || null,
        craftSteelMode: $("craftSteelMode").value,
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
$("settings").addEventListener("submit", save);
$("test").addEventListener("click", test);
$("show").addEventListener("change", () => {
  $("key").type = $("show").checked ? "text" : "password";
});
load();
