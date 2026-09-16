import { preferences, SELL_FROM } from "./lib/settings.mjs";
const $ = (id) => document.getElementById(id);
const fields = [
  "equipment",
  "cases",
  "travel",
  "picker",
  "collapsed",
  "casesCollapsed",
  "roundTrip",
];
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
async function load() {
  try {
    const r = await message({ type: "getSettings" });
    const p = preferences(r.settings);
    $("key").value = r.apiKey ?? "";
    $("margin").value = p.minMarginPct;
    $("interval").value = p.intervalSec;
    $("sellFrom").value = SELL_FROM.includes(p.sellFrom) ? p.sellFrom : "epic";
    for (const field of fields) $(field).checked = p[field];
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
      fields.map((field) => [field, $(field).checked]),
    );
    const r = await message({
      type: "saveSettings",
      settings: {
        ...patch,
        apiKey: $("key").value.trim(),
        minMarginPct: $("margin").value,
        intervalSec: $("interval").value,
        sellFrom: $("sellFrom").value,
      },
    });
    if (r.error) throw new Error(r.message);
    status("Saved. Open game tabs pick up changes within five seconds.", "ok");
    $("margin").value = r.settings.minMarginPct;
    $("interval").value = r.settings.intervalSec;
    $("sellFrom").value = r.settings.sellFrom;
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
