# 1.4.0 release checklist

## Automated gate

- `npm ci --ignore-scripts`
- `npm run check`
- Inspect `git diff --check`.
- Keep `package.json` and `manifest.json` versions aligned.

## Manual gate — required before merging/releasing

These checks require a real Chromium browser and the user's own WarEra account. They have **not** been completed by the automated test suite.

- Reload the existing unpacked extension from the same folder, then reload the game. Confirm the name is WarEra Lens and existing key/preferences remain available.
- Test the key explicitly from settings. Check accepted, rejected, missing-header, offline and cooldown states. Never put keys in screenshots, logs or issues.
- Equipment market: verify BUY remains unobstructed at narrow, normal and wide widths; repeat at 200% zoom. Check common and mythic offers, skins, hover colors, colorblind theme, own DELETE listings and Load more.
- Change the selected item while sales are loading. Verify the displayed sales match the selected item and unknown picker tiles remain visible. Show all and close the picker; no game width or visibility should remain changed.
- Resource market and inventory: compare sealed bids and depth with the game; check all three cases. Collapse/expand and manually refresh. Missing prices/depth must not produce SELL or OPEN EV.
- Open the map menu before and after distance loads. Toggle one way / round trip. Check that toggling does not trigger the game's travel action and the native control remains usable by keyboard.
- Leave the tab hidden for two minutes, return, and confirm stale labels are paused while new data is read.
- Navigate between market, inventory and profile without reloading. Verify panels disappear where not applicable and appear on return.
- Test two tabs, change the saved key during a delayed request, and verify no old-account quote becomes active.
- Record real Performance traces on a large loaded market and a busy map. Compare scan counts, main-thread time and requests with 1.3.0. Synthetic DOM tests are not an FPS or memory benchmark.

## Known assumptions

The valuation rules were carried from the repository's 2026-09-16 model; no new live game-rule audit was performed. The code contains references to historical research files absent from this extension repository. Their sample sizes and results are provenance comments, not independently reproduced evidence in this release.

Wooden cases assume uniform integer budgets from 20 to 80 production points, carry both floor and round quantity models, and require enough observed depth for every possible outcome. This band captures that rounding assumption only, not all uncertainty about the game's rules.

Battle case openings follow the drop policy (`sellFrom`, default epic): rarities below the threshold at their depth-walked scrap quote, from the threshold up at the game's average item price; a sold rarity without an average falls back to scrap and is flagged. The average is a mean of recent sales, not a bid, so the sold part of the value is an estimate that takes time to realise. Battle case scrap EV weights each possible rarity outcome against its own depth quote. This can slightly differ from the legacy pre-rounded `scrapsPerCase × best bid` statistic. Historical equipment resale estimates are partial, probability-weighted contributions; missing item prices are never imputed. Resale is not used as instant liquidation or as the basis for the primary case signal.

Displayed purchase prices and quoted proceeds receive no additional tax adjustment, preserving the original project's convention. Validate this convention against the current game before relying on margins. Travel assumes 10 stamina or 2 oil per region per leg; the extension does not read stamina balance, guarantee a case is still available, or model route changes between outbound and return legs.

The accepted-key check still uses the project's rate-limit-bucket heuristic (greater than 100). A missing header is now unverified, not a rejected-key claim. If the API changes bucket policy or undocumented procedures, update fixtures and the adapter; do not silently fall back to keyless requests.
