# Release checklist

Go through the newest release's section and the manual gate on the live game, with your own account, before publishing. Then [CHROME-WEB-STORE.md](CHROME-WEB-STORE.md).

## 3.7.0 on the dev page (v0.27) and the live page (v0.26)

3.7.0 was checked on the test suite, with the auction cards and the Start an auction form built from what the dev page showed on 2026-10-17 (`fixtures/v027-auctions.json`). It has not run on the dev page. `npm run build:dev`, load `dist/dev` unpacked (it only runs on dev.warera.io and asks apidev.warera.io; give it your dev API key), reload the game.

- **Live first (v0.26).** The equipment market looks and tags exactly as 3.6.0: SNIPE / FLIP / sells on every row, the bar, the sell form's price, the picker. Nothing reads "offers not read".
- **The auction page.** `/market/auctions` (and `/market/equipments`, which leads there) has the bar. Every card carries a line; open Details on one: buy now and the max before tax match the card, the tax is your country's ("the page's notice"), the next bid before tax is the BID amount ÷ (1 + tax). A card with bids reads its current bid as the start.
- **Tags.** With scrap bids high enough a card's buy now is under its scraps: SNIPE and "buy now". A card whose BID amount is under its scraps but buy now is not: BID and "bid ≤ x", in its last 10 minutes only (sort by Ending soon; with more time left the card has no BID and Details keep "bid at most x"); the x, typed into the game's bid dialog plus your tax, stays under the scraps by the SNIPE margin. Change your country's tax (or test with a 0% country): the lines follow; a card whose numbers do not fit the notice reads "tax check failed" and has no tag.
- **Skins.** A skinned piece (vampireCountessGloves) is priced as the tier its stat falls in (precision 60: mythic, scrap 292 at 0.2).
- **Start an auction.** Pick one piece: the line under the max price says start and max; **use** fills both inputs and the game shows no error; nothing is listed until START AUCTION. Pick a second piece: "pick one piece". Close the form: the line goes with it.
- **The Ledger.** Open a toolbox (and, when one drops, a wooden case with toolboxes): the Ledger shows a Toolbox chip, the wooden chip counts the unpriced drop apart, the history keeps reading (no "History read failed").
- **The case window.** Open a toolbox: no case panel. A normal case still shows its panel.
- **Grid.** Open "+" (Select an item), pick an item, close it: rows keep their rarity.

## 3.6.0 on the live page

3.6.0 was checked on the test suite (unit, worker and jsdom page tests) and in headless Chromium on the synthetic market (`node scripts/jitter.mjs`, `node scripts/store-assets.mjs`). Not seen on the live game. Reload the extension itself first, then the game.

- **Sniper craft, seen.** Open the game's craft window, pick a slot (the button reads CRAFT), craft one. Within ~10 s the Ledger (Today) lists it with ◎ and its cost carries twice the tier's steel (epic: 16 steel, not 8); its title says "picked in the game's craft window". Craft one with CRAFT RANDOM: no ◎, the base steel. A craft whose button press was missed (another device) and that is part of a run of 6 weapons or 5 of one armour piece carries a faint ◎ ("… in a row").
- **The setting.** Settings, Advanced, How you craft reads Detect for an install that never chose; Always random takes every ◎ away, Always sniper craft puts one on every craft; back to Detect.
- **The Ledger's list.** All: "1–50 of N" under the table, Older › and » walk to the oldest page, « and ‹ Newer back; Craft / Case / Buy / Loot filter with their counts; a new window or filter starts at the newest page; the list scrolls in its own box and does not jump back to the top when the numbers refresh.
- **Steady rows.** Reload the equipment market with the network throttled (DevTools, Slow 4G): every row's line appears once with READING and keeps its width while the tag, the game's average and the sales arrive; the game's price and BUY do not move after the line first shows. Load more: the new rows show with their lines at once. Navigate to another game page and back: the lines come within a moment, not after seconds.
- **Prices.** Details on a top roll whose value rests on similar stats says "brought to these stats"; its value sits above the plain median of the sales listed beside it. A sell-form suggestion and a Ledger held value still follow the sales of the same stats.
- **Sales refresh.** With DevTools' network panel on the extension's worker (chrome://extensions, the worker link), a refresh of an item's sales five minutes after the first read asks one or two pages of `transaction.getPaginatedTransactions`, not ten.
- **Store package.** `npm run package`; load the zip's contents unpacked in a fresh profile (unzip it into a folder) and run through the bar, the Ledger and the settings.

## 3.3.0 on the live page

The sell form, the picker and Quick dismantle were read live on 2026-10-10 (one piece picked, nothing listed); the new code ran only in tests (the MCP tab stayed hidden). Reload the extension itself first: a page reload alone keeps the old background.

- **Sell form:** pick one piece. Under PRICE: "◈ price · why · use" and "sold … · ask … · rising". With the same item selected on the market, the ask and its age appear; **use** fills the price; PUT ON SALE untouched. Pick two different pieces: "list apart", no use.
- **Quick dismantle (inventory):** the bar sits under "Quick dismantle"; marks on tiles; ↗ Flip and ♻ Scrap dim the rest; SELECT ALL and QUICK DISMANTLE are the game's and untouched.

## 3.2.0 on the live page

Checked on the tests and the synthetic page; the picker's DOM was read live on 2026-10-10 (structure only). Not seen on the live game:

- **Inventory picker:** open "+ NEW ITEM OFFER" and a slot. The bar above the tiles shows "All · ⚒ Crafted · ↓ Bought · ▣ Case · ✦ Loot" with counts; every tile carries a small mark (hover: "Crafted 10 Oct · cost 150 · sells 154", or "14 identical: 10 bought · 4 loot", or "?" when the history does not hold it). Choose Crafted: the others dim, scrolling the list keeps the marks and the dimming on the rows it draws; nothing is selected or listed by our clicks.
- **The market item in the picker:** with an item selected on the market, "◎ legendary boots N ×" dims the other items; × lifts it.
- **Sales windows:** rows read "N same · 24 h" for busy items and widen to "· 3 d" or "· 7 d" only for rare stats; a value never rests on more than 50 sales.
- **Tables:** the Ledger and Craft tab tables keep their own dark rows, without the game's grey stripes.

## 3.1.0 on the live page

3.1.0 was checked on the test suite and on a synthetic page (the real extension code, the account's real history, a stand-in for the game's dialogs). Not seen on the live game:

- **Craft window placement:** the panel goes above the row that holds CRAFT and the game's other buttons (the first ancestor of CRAFT with two native buttons that is not the whole dialog), else just before CRAFT. Confirm it sits full width above the buttons and the buttons keep their own look.
- **Eco / War in a game window:** clicking the switch flips it and the numbers, and does not close or click through the game's dialog.
- **A fresh craft:** craft one with the window open on the market page; within seconds the piece is first in the list with its stats, `~value` from sales of the same stats (else `≈`) and its result. Its item's sales are read before the market's other items.
- **~ and ≈:** on a few rows and Ledger lines, `~` only where the label says same or similar stats.
- **Eco numbers:** the Ledger's "N in battle, not counted" and the craft window's "in battle" rows match pieces you remember wearing.

## Automated gate

- `npm ci --ignore-scripts`
- `npm run check` (lint, typecheck, the manifest and store checks, tests, formatting)
- `npm run package` builds `dist/warera-plus-<version>.zip`; note its SHA-256.
- Inspect `git diff --check`.
- Keep `package.json` and `manifest.json` versions aligned, with a `CHANGELOG.md` entry (the validator checks both).
- `node scripts/jitter.mjs` and `node scripts/jitter.mjs --late`: no more than one layout shift while the market settles, none added by the extension when the offers are drawn late or on Load more.
- `node scripts/screenshots.mjs` renders the synthetic fixture; compare `docs/screenshots/` at wide and narrow widths. `node scripts/store-assets.mjs` renders the store's images into `docs/store/`.

## Manual gate — required before merging/releasing

These checks require a real Chromium browser and the user's own WarEra account. They have **not** been completed by the automated test suite or by the synthetic fixture. Checked against the live game: the row layout (two rows, 2026-10-07), the case and craft windows' text and where the panel goes (2026-10-08, by injecting the readers), and the whole history pipeline run in Node against one account's live feed with the extension's own worker code (28,641 transactions, 11,778 of 11,780 fates tied). Not seen: the installed 3.0.0 itself on the page.

- Reload the existing unpacked extension from the same folder, then reload the game. Confirm existing key/preferences remain available and the settings page shows the two thresholds (SNIPE ROI, FLIP gap) and the modules.
- Test the key explicitly from settings. Check accepted, rejected, missing-header, offline and cooldown states. Never put keys in screenshots, logs or issues.
- **The bar:** on `/market/equipments` confirm one bar above the tax notice, nothing open under it, the game's grid where it was (compare with the game's own spacing). Click each tab: Market, Craft, Ledger open under the bar, the same tab again closes it, the choice survives a page reload. With the Equipment module off, confirm the bar still mounts with the Craft and Ledger tabs only. Confirm a tab or Refresh clicked while the game tab is in the background shows its effect once the tab is visible again (hidden tabs render nothing by design).
- **Row lines:** verify BUY remains unobstructed at narrow, normal and wide widths; repeat at 200% zoom. Check common and mythic offers, skins, hover colors, colorblind theme, own DELETE listings and Load more. Confirm the line shows the tag, the scrap profit with ROI and a "sells" value on every row: the game's average (`game avg`) within a minute, then `N sales same stats` / `similar stats` / `any stats` as each item's 7-day sales arrive (every item on the page is read, the grid's item first). Open Details on a weapon row and confirm the matched sales' span (`atk 101–106 · crit 16%`) brackets the row's own stats.
- **Weapon and armour rows:** the reader was fixed against two live rows on 2026-10-07 (a sniper `101 · 16% · 100%`, gloves `12% · 100%`): the last percentage before the price is the durability, every number before it a stat. Confirm on one weapon, one armor piece (bare stat, e.g. `46`) and one helmet (`NN%`) that Details' "This piece" line names the right stats and durability. A wrong read must become `stats unreadable`, never a wrong number.
- **Tags:** with the FLIP threshold at 10%, find a row whose "sells" value rests on same or similar stats and exceeds its price by more, and confirm FLIP; confirm a row whose value is the game's average or `any stats` never shows FLIP however large the gap; raise the threshold above the gap and confirm PASS; confirm SNIPE wins when the scraps also beat the price. Compare one FLIP row's value with the game's transaction list filtered by eye to the same stats: the median of those sales in the last 7 days must be close. Open Details with the mouse and with the keyboard (Tab to the ▸ button, Enter/Space); confirm the row's own click behaviour is not triggered by the button and that focus stays on it after a refresh.
- **Market tab:** confirm the six scrap floors match the game's resource market walked through the bids; select an item in the grid and confirm the fills line (count, median, low, high, last) against the game's transaction list; with the network off, refresh and confirm `last read failed` stays until a read succeeds.
- **Craft tab:** confirm the scrap and steel asks match the resource market; for one tier compare the random cost with the game's craft dialog at those prices (scraps × ask + steel × ask; the dialog shows the random steel, a chosen slot doubles it); confirm each slot's average in the opened tier matches the "Current value" the game prints on that item; with the averages still loading, confirm `k/6 slots` and no EV, never a guess.
- **History and Ledger (3.0.0):** reload the extension and the game. The Ledger head says the history is filling from the start of the profile and the count grows by about 800 transactions every 5 seconds; for an account of ~25,000 transactions it reaches "since <your first day>" in about 2 minutes, with the game tab visible. Reload the page and the extension: the history is back at once, without a new fill. Compare one day's Money with what you remember selling and scrapping that day. Change the API key: the history stays.
- **Case window:** open a case tile in the inventory. Above the open buttons: "Opening is worth ~X g a case … it sells now for Y g (best bid) → OPEN/SELL/EVEN", your openings of that case today and all time, and the last one opened. Press OPEN CASE: within ~3–8 seconds "today" counts one more opening and "Last opened" names what came out with its value.
- **Craft window:** open CRAFT, pick a tier. Above CRAFT RANDOM: the random craft's cost at the asks and its worth at the game's averages, your crafts of that tier, your last craft. Craft one: within seconds the last craft line names the piece, its stats and its value against its cost.
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

The accepted-key check still uses the project's rate-limit-bucket heuristic (greater than 100). A missing header is now unverified, not a rejected-key claim. If the API changes bucket policy or undocumented procedures, update fixtures and the adapter. Since 3.4.0 an empty key reads keyless (books, averages, players) by design; a key that is set and not accepted is never silently replaced by keyless reads. Live check for 3.4.0: clear the key, reload the extension and the game; the floors, SNIPE tags, case and craft windows fill; the market sales line, the Ledger, the craft window's results and the picker say they need the key; no request to transaction.getPaginatedTransactions is made.

Live check for 3.5.0: select a weapon in the market grid, set CRIT. CHANCE (and ATTACK), open + NEW ITEM OFFER and a slot: nothing moves (3.5.1). Press ⇅ by crit: the game's list blanks for a moment while it is read (no rows flying past; with the game's Weapons + a rarity filter set, not even that), then the bar shows the item by crit then attack, the pieces the filter lets through lit and "N of M" in its head. A click on a piece selects it (0/5 -> 1/5) and a second click keeps it selected. Change the game's own filter (Weapons, a rarity): the list is read again. In Quick dismantle the bar offers the items in the window, weapons first.
