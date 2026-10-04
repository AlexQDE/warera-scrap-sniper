# 1.6.0 release checklist

## Automated gate

- `npm ci --ignore-scripts`
- `npm run check`
- Inspect `git diff --check`.
- Keep `package.json` and `manifest.json` versions aligned.
- `node scripts/screenshots.mjs` renders the synthetic fixture; compare `docs/screenshots/` at wide and narrow widths.

## Manual gate — required before merging/releasing

These checks require a real Chromium browser and the user's own WarEra account. They have **not** been completed by the automated test suite or by the synthetic fixture.

- Reload the existing unpacked extension from the same folder, then reload the game. Confirm the name is WarEra Plus and existing key/preferences remain available.
- Test the key explicitly from settings. Check accepted, rejected, missing-header, offline and cooldown states. Never put keys in screenshots, logs or issues.
- Equipment market: verify BUY remains unobstructed at narrow, normal and wide widths; repeat at 200% zoom. Check common and mythic offers, skins, hover colors, colorblind theme, own DELETE listings and Load more.
- **Offer annotation (new):** on real rows, confirm the compact line shows scrap profit, ROI and the resale cell; open **Details** with the mouse and with the keyboard (Tab to the button, Enter/Space); confirm the row's own click behaviour is not triggered by the Details button and that focus stays on the button after a refresh.
- **Row reader (new):** on real rows, confirm `N readable stats` in the summary matches rows that show a durability percentage and a stat number, and that the Details line `Durability X% · stat Y` reads the right numbers. If the live row prints its stat differently from the fixture (`extension/lib/offers.mjs`, `readStats`), update the reader and its fixture; a wrong read must become `Stats unreadable`, never a wrong number.
- **Resale (new):** select an item in the grid; confirm the resale cell shows `select this item` on rows of other items, `reading sales` then a value or `N of 5 fills` on rows of the selected item, and `sales read failed` with the summary count unchanged when the API is unreachable (toggle the network).
- **Tax notice (new):** confirm the Craft Desk's tax field placeholder shows the rate printed in the market's "Market tax" notice; if the notice format differs, `dom.taxRateFromText` must return null and the field must say `none read`.
- **Craft Desk (new):** open Details; confirm steel and scrap asks match the game's resource market; enter one recipe from the game's craft screen, save, reload the page and confirm it is still there; pick an item with recent sales and compare the balanced listing price with the market's recent fills; confirm "Buy now at the asks" matches a manual walk of the ask book.
- **Ledger (new):** record a craft, list it, record a sale, reload the page and confirm the entries persist; export, delete an entry, import the file and confirm the merge; change the API key and confirm the ledger survives.
- **Settings page (new layout):** open the popup and the options tab; verify at the popup's natural width and in a 320 px wide window that nothing overflows horizontally and that Advanced opens and closes with the keyboard.
- Change the selected item while sales are loading. Verify the displayed sales match the selected item and unknown picker tiles remain visible. Show all and close the picker; no game width or visibility should remain changed.
- Resource market and inventory: compare sealed bids and depth with the game; check all three cases. Collapse/expand and manually refresh. Missing prices/depth must not produce SELL or OPEN EV.
- Open the map menu before and after distance loads. Toggle one way / round trip. Check that toggling does not trigger the game's travel action and the native control remains usable by keyboard.
- Leave the tab hidden for two minutes, return, and confirm stale labels are paused while new data is read.
- Navigate between market, inventory and profile without reloading. Verify panels (equipment, Craft Desk, cases, trip line) disappear where not applicable and appear on return, once each.
- Test two tabs, change the saved key during a delayed request, and verify no old-account quote becomes active.
- Record real Performance traces on a large loaded market and a busy map. Compare scan counts, main-thread time and requests with 1.4.1; the synthetic numbers in `docs/perf/` are from the fixture, not the live page.

## Known assumptions

The valuation rules were carried from the repository's 2026-09-16 model; no new live game-rule audit was performed. The code contains references to historical research files absent from this extension repository. Their sample sizes and results are provenance comments, not independently reproduced evidence in this release.

**Crafting.** No recipe, craft cost or outcome distribution is shipped: the desk works only from recipes the player enters and from the fills it has read. The fixture recipes in `fixtures/recipes.json` are synthetic and must never be loaded into a release. The sales-weighted outcome assumes a crafted piece sells like the recent fills of its item; a roll distribution by stat is not modelled because the fills read so far do not expose the stat. The market feed's `money` on a fill is taken as the price recorded for that sale; whether it is the buyer's total or the seller's proceeds has not been verified against the game, so proceeds shown "after tax" apply the tax rate to that figure exactly once.

**Rows.** The stat reader takes the first bare integer line before the price as the stat and `NN%` as durability, from synthetic fixtures; the live row layout must be confirmed. The tax rate parser expects a "Market tax" notice with a percentage.

Wooden cases assume uniform integer budgets from 20 to 80 production points, carry both floor and round quantity models, and require enough observed depth for every possible outcome. This band captures that rounding assumption only, not all uncertainty about the game's rules.

Battle case openings follow the drop policy (`sellFrom`, default epic): rarities below the threshold at their depth-walked scrap quote, from the threshold up at the game's average item price; a sold rarity without an average falls back to scrap and is flagged. The average is a mean of recent sales, not a bid, so the sold part of the value is an estimate that takes time to realise. Historical equipment resale estimates are partial, probability-weighted contributions; missing item prices are never imputed.

Displayed purchase prices and quoted scrap proceeds receive no additional tax adjustment, preserving the original project's convention. Validate this convention against the current game before relying on margins. Travel assumes 10 stamina or 2 oil per region per leg; the extension does not read stamina balance, guarantee a case is still available, or model route changes between outbound and return legs.

The accepted-key check still uses the project's rate-limit-bucket heuristic (greater than 100). A missing header is now unverified, not a rejected-key claim. If the API changes bucket policy or undocumented procedures, update fixtures and the adapter; do not silently fall back to keyless requests.
