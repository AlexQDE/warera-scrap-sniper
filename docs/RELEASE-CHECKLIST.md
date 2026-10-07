# 2.2.0 release checklist

## Automated gate

- `npm ci --ignore-scripts`
- `npm run check`
- Inspect `git diff --check`.
- Keep `package.json` and `manifest.json` versions aligned.
- `node scripts/screenshots.mjs` renders the synthetic fixture; compare `docs/screenshots/` at wide and narrow widths.

## Manual gate — required before merging/releasing

These checks require a real Chromium browser and the user's own WarEra account. They have **not** been completed by the automated test suite or by the synthetic fixture. Of 2.0.0 to 2.2.0, only the row layout has been checked against the logged-in page (two live rows, 2026-10-07); the rest, the feed store and the ledger included, is unseen by the author.

- Reload the existing unpacked extension from the same folder, then reload the game. Confirm existing key/preferences remain available and the settings page shows the two thresholds (SNIPE ROI, FLIP gap) and the modules.
- Test the key explicitly from settings. Check accepted, rejected, missing-header, offline and cooldown states. Never put keys in screenshots, logs or issues.
- **The bar:** on `/market/equipments` confirm one bar above the tax notice, nothing open under it, the game's grid where it was (compare with the game's own spacing). Click each tab: Market, Craft, Ledger open under the bar, the same tab again closes it, the choice survives a page reload. With the Equipment module off, confirm the bar still mounts with the Craft and Ledger tabs only. Confirm a tab or Refresh clicked while the game tab is in the background shows its effect once the tab is visible again (hidden tabs render nothing by design).
- **Row lines:** verify BUY remains unobstructed at narrow, normal and wide widths; repeat at 200% zoom. Check common and mythic offers, skins, hover colors, colorblind theme, own DELETE listings and Load more. Confirm the line shows the tag, the scrap profit with ROI and a "sells" value on every row: the game's average (`game avg`) within a minute, then `N sales same stats` / `similar stats` / `any stats` as each item's 7-day sales arrive (every item on the page is read, the grid's item first). Open Details on a weapon row and confirm the matched sales' span (`atk 101–106 · crit 16%`) brackets the row's own stats.
- **Weapon and armour rows:** the reader was fixed against two live rows on 2026-10-07 (a sniper `101 · 16% · 100%`, gloves `12% · 100%`): the last percentage before the price is the durability, every number before it a stat. Confirm on one weapon, one armor piece (bare stat, e.g. `46`) and one helmet (`NN%`) that Details' "This piece" line names the right stats and durability. A wrong read must become `stats unreadable`, never a wrong number.
- **Tags:** with the FLIP threshold at 10%, find a row whose "sells" value rests on same or similar stats and exceeds its price by more, and confirm FLIP; confirm a row whose value is the game's average or `any stats` never shows FLIP however large the gap; raise the threshold above the gap and confirm PASS; confirm SNIPE wins when the scraps also beat the price. Compare one FLIP row's value with the game's transaction list filtered by eye to the same stats: the median of those sales in the last 7 days must be close. Open Details with the mouse and with the keyboard (Tab to the ▸ button, Enter/Space); confirm the row's own click behaviour is not triggered by the button and that focus stays on it after a refresh.
- **Market tab:** confirm the six scrap floors match the game's resource market walked through the bids; select an item in the grid and confirm the fills line (count, median, low, high, last) against the game's transaction list; with the network off, refresh and confirm `last read failed` stays until a read succeeds.
- **Craft tab:** confirm the scrap and steel asks match the resource market; for one tier compare the random cost with the game's craft dialog at those prices (scraps × ask + steel × ask; the dialog shows the random steel, a chosen slot doubles it); confirm each slot's average in the opened tier matches the "Current value" the game prints on that item; with the averages still loading, confirm `k/6 slots` and no EV, never a guess.
- **Ledger tab (2.2.0):** confirm the header names your own account and says since when the feed is on record (for a busy account the first read covers days, not a week; the record grows forward). Craft one piece and buy one on the market: within a minute, on any tab, the bar's head shows today's result and the Ledger lists both with their cost. Sell one of them (or have it bought) and dismantle the other: within a minute the rows read sold / scrapped with the proceeds and the wait, and _Result · today_ moves by proceeds minus cost. Sell a piece you got before the store's first read: it must appear with "before the feed on record" and be counted in the proceeds but not in the result (the head carries a `*`). Reload the extension and the page: the store must be back at once without a new backfill (one page per feed, the network panel shows three `getPaginatedTransactions` calls a minute). Change the API key: the store must survive. With a player id set in settings, confirm the ledger reads that account and names it. On a page without the profile links (logged out), confirm it says the account was not found instead of showing anything.
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

**Rows.** The stat reader takes the last `NN%` before the price as the durability and every number before it as a stat, from two live rows (a sniper and precision gloves) and synthetic fixtures; helmets and armor rows are assumed to follow the same pattern. The value method (a tenth of each stat's range for "same", a quarter for "similar", three and five sales) is a design choice, not measured against what the market actually pays for a stat step.

**Values.** The game's average (`gameStat.getEquipmentAvgByCode`) is an undocumented procedure that answered the key on 2026-10-07; if it disappears, rows fall back to fills only and the craft board shows `0/6 slots`.

Wooden cases assume uniform integer budgets from 20 to 80 production points, carry both floor and round quantity models, and require enough observed depth for every possible outcome. Battle case openings follow the drop policy (`sellFrom`, default epic). Travel assumes 10 stamina or 2 oil per region per leg; the extension does not read stamina balance, guarantee a case is still available, or model route changes between outbound and return legs.

The accepted-key check still uses the project's rate-limit-bucket heuristic (greater than 100). A missing header is now unverified, not a rejected-key claim. If the API changes bucket policy or undocumented procedures, update fixtures and the adapter; do not silently fall back to keyless requests.
