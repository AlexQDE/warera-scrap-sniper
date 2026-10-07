# 2.0.0 release checklist

## Automated gate

- `npm ci --ignore-scripts`
- `npm run check`
- Inspect `git diff --check`.
- Keep `package.json` and `manifest.json` versions aligned.
- `node scripts/screenshots.mjs` renders the synthetic fixture; compare `docs/screenshots/` at wide and narrow widths.

## Manual gate — required before merging/releasing

These checks require a real Chromium browser and the user's own WarEra account. They have **not** been completed by the automated test suite or by the synthetic fixture. Nothing of 2.0.0 has been seen on the logged-in page by its author.

- Reload the existing unpacked extension from the same folder, then reload the game. Confirm existing key/preferences remain available and the settings page shows the two thresholds (SNIPE ROI, FLIP gap) and the modules.
- Test the key explicitly from settings. Check accepted, rejected, missing-header, offline and cooldown states. Never put keys in screenshots, logs or issues.
- **The bar:** on `/market/equipments` confirm one bar above the tax notice, nothing open under it, the game's grid where it was (compare with the game's own spacing). Click each tab: Market, Craft, Ledger open under the bar, the same tab again closes it, the choice survives a page reload. With the Equipment module off, confirm the bar still mounts with the Craft and Ledger tabs only. Confirm a tab or Refresh clicked while the game tab is in the background shows its effect once the tab is visible again (hidden tabs render nothing by design).
- **Row lines:** verify BUY remains unobstructed at narrow, normal and wide widths; repeat at 200% zoom. Check common and mythic offers, skins, hover colors, colorblind theme, own DELETE listings and Load more. Confirm the line shows the tag, the scrap profit with ROI and a value on every row within a minute of loading (the game's average, labelled `game avg`), and that rows of the selected item switch to `N same-roll fills` / `fills in the roll's band` / `fills, any roll` once its fills are read.
- **Weapon rows:** read one weapon row's visible lines (the extension's Details show `Durability X% · stat Y`). The reader takes the FIRST `NN%` line as durability and the first bare integer as the stat. If the game prints the weapon's crit chance (`NN%`) before the durability, the durability read is wrong; update `offers.readStats` (and its fixture) to take the last `NN%` and record the live layout in GAME-FACTS §7. A wrong read must become `Stats unreadable`, never a wrong number. No weapon listings were on the market when 2.0.0 was built, so this is unverified.
- **Tags:** with the FLIP threshold at 10%, find a row whose value exceeds its price by more and confirm FLIP; raise the threshold above the gap and confirm PASS; confirm SNIPE wins when the scraps also beat the price. Open Details with the mouse and with the keyboard (Tab to the ▸ button, Enter/Space); confirm the row's own click behaviour is not triggered by the button and that focus stays on it after a refresh.
- **Market tab:** confirm the six scrap floors match the game's resource market walked through the bids; select an item in the grid and confirm the fills line (count, median, low, high, last) against the game's transaction list; with the network off, refresh and confirm `last read failed` stays until a read succeeds.
- **Craft tab:** confirm the scrap and steel asks match the resource market; for one tier compare the random cost with the game's craft dialog at those prices (scraps × ask + steel × ask; the dialog shows the random steel, a chosen slot doubles it); confirm each slot's average in the opened tier matches the "Current value" the game prints on that item; with the averages still loading, confirm `k/6 slots` and no EV, never a guess.
- **Ledger tab:** confirm the header names your own account (the page's inventory and skills links); craft one piece in the game, refresh and confirm it appears within the 3-minute cache with its roll and a cost equal to the recipe at the day's average prices; sell or dismantle it and confirm the row's fate changes after a refresh; on an account with many market rows confirm a piece sold more than a day ago is shown sold, not held (the 2.0.0 feed walk). With a player id set in settings, confirm the ledger reads that account and names it. On a page without the profile links (logged out), confirm it says the account was not found instead of showing anything.
- **Tax notice:** the market tax is the buyer's; confirm no price on the bar or the rows is adjusted by it.
- Change the selected item while fills are loading. Verify the displayed fills match the selected item and unknown picker tiles remain visible. Show all and close the picker; no game width or visibility should remain changed.
- Resource market and inventory: compare sealed bids and depth with the game; check all three cases. Collapse/expand and manually refresh. Missing prices/depth must not produce SELL or OPEN EV.
- Open the map menu before and after distance loads. Toggle one way / round trip. Check that toggling does not trigger the game's travel action and the native control remains usable by keyboard.
- Leave the tab hidden for two minutes, return, and confirm stale labels are paused while new data is read.
- Navigate between market, inventory and profile without reloading. Verify the bar, the case strip and the trip line disappear where not applicable and appear on return, once each.
- Test two tabs, change the saved key during a delayed request, and verify no old-account quote becomes active.
- Record real Performance traces on a large loaded market and a busy map. Compare scan counts, main-thread time and requests with 1.8.0; the synthetic numbers in `docs/perf/` are from the fixture, not the live page.

## Known assumptions

The valuation rules were carried from the repository's 2026-09-16 model; no new live game-rule audit was performed. The code contains references to historical research files absent from this extension repository. Their sample sizes and results are provenance comments, not independently reproduced evidence in this release.

**Crafting.** The recipe table is shipped ([docs/GAME-FACTS.md](GAME-FACTS.md) §3): scraps equal to the tier's scrap value, steel 1 / 2 / 4 / 8 / 16 / 32 for a random craft and twice that for a chosen slot (the game's craft dialog shows the random steel; chosen doubles it). The random craft's slot odds (30% weapon, 14% each armour slot) are measured over 2,200 crafts, not read from the game. The value of a craft is the game's average price per item, a mean of recent sales of any roll; a roll distribution by stat is not modelled.

**Rows.** The stat reader takes the first bare integer line before the price as the stat and the first `NN%` as durability, from synthetic fixtures; the live weapon row layout is unverified (see the manual gate). A weapon's roll is keyed by its attack for the same-roll value; the fills carry the crit too, but the row does not read it.

**Values.** The game's average (`gameStat.getEquipmentAvgByCode`) is an undocumented procedure that answered the key on 2026-10-07; if it disappears, rows fall back to fills only and the craft board shows `0/6 slots`.

Wooden cases assume uniform integer budgets from 20 to 80 production points, carry both floor and round quantity models, and require enough observed depth for every possible outcome. Battle case openings follow the drop policy (`sellFrom`, default epic). Travel assumes 10 stamina or 2 oil per region per leg; the extension does not read stamina balance, guarantee a case is still available, or model route changes between outbound and return legs.

The accepted-key check still uses the project's rate-limit-bucket heuristic (greater than 100). A missing header is now unverified, not a rejected-key claim. If the API changes bucket policy or undocumented procedures, update fixtures and the adapter; do not silently fall back to keyless requests.
