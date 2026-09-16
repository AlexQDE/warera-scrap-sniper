import { createController } from "./lib/controller.mjs";

// Keep the original storage keys and extension identity; never expose secrets to content scripts.
// Content scripts must not read the key from storage.local. Older Chromes
// only offer setAccessLevel on storage.session: there the worker still starts
// (the content side never reads storage directly), it just cannot tighten it.
const ready = (async () => {
  try {
    if (typeof chrome.storage.local.setAccessLevel === "function")
      await chrome.storage.local.setAccessLevel({
        accessLevel: "TRUSTED_CONTEXTS",
      });
  } catch {
    /* unsupported on this Chrome: keep working without the restriction */
  }
})();
const controller = createController({
  storage: chrome.storage.local,
  session: chrome.storage.session,
  fetchImpl: fetch,
});
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  const trusted =
    sender.id === chrome.runtime.id &&
    sender.url?.startsWith(chrome.runtime.getURL(""));
  const content =
    sender.id === chrome.runtime.id &&
    sender.url?.startsWith("https://app.warera.io/");
  if (!trusted && !content) {
    respond({ error: "forbidden", message: "Untrusted sender" });
    return false;
  }
  ready
    .then(async () => {
      if (msg?.type === "openSettings") {
        await chrome.runtime.openOptionsPage();
        return { ok: true };
      }
      return controller.handle(msg, { trusted });
    })
    .then(respond)
    .catch(() =>
      respond({
        error: "internal",
        message: "WarEra Lens could not complete this request",
      }),
    );
  return true;
});
chrome.runtime.onInstalled.addListener(() => {
  ready.then(() => controller.cleanup()).catch(() => {});
});
