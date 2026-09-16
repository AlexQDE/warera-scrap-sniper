// The original marker is retained so re-injection cannot start a second copy.
(async () => {
  if (window.__scrapSniper) return;
  window.__scrapSniper = true;
  try {
    const { startLens } = await import(chrome.runtime.getURL("lib/app.mjs"));
    const app = await startLens();
    window.addEventListener("pagehide", (e) => {
      if (!e.persisted) app.dispose();
    });
  } catch {
    const notice = document.createElement("div");
    notice.dataset.lens = "";
    notice.textContent =
      "WarEra Lens could not start. Reload the game page after updating the extension.";
    document.body.prepend(notice);
  }
})();
