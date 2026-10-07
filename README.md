# WarEra Plus

Read-only decision support inside [WarEra](https://app.warera.io): what an offer is worth, what a craft costs and returns, what your own crafts made. Formerly **WarEra Lens**, originally **WarEra Scrap Sniper**; same extension, same settings and key.

The extension compares offers and estimates. It never buys, crafts, lists, opens a case or travels for you. It uses your own API key and has no runtime dependencies or build step.

## What changed in 2.2.0

- **The ledger lives on the API feed and keeps it.** The worker now holds your own transactions in a store (`feed:<player id>`): the first read walks 7 days back, then every minute while the equipment market is open it reads each feed newest first and stops at the first row it already holds, so a sale of your piece by someone else shows within a minute, whatever tab is open. The store keeps 30 days (3,000 rows a feed), survives a key change, and the head of the bar prints today's result at all times.
- **Pieces, not only crafts.** A piece is anything you got: crafted (cost = the recipe at the craft day's average scrap and steel prices) or bought on the market (cost = what you paid). Its fate is your later sale of that item id, or a dismantle. A sale of a piece older than the store shows its proceeds with "before the feed on record" and is counted apart, never guessed.
- **The day's result, by the day things happened.** _Result_ is what was sold or scrapped today against its cost (with the number of pieces whose cost is not on record); _Crafted_ and _Bought_ count today's acquisitions and how many of them already sold, for how much; _Held now_ prices everything still yours by the sales of its own stats. Days are your local days. Today or 7 days.
- **Coverage, said.** The ledger head says since when the feed is on record. For an account trading ~100 rows per 3.5 hours the first read covers three to four days, not seven; the store grows forward from there.

## What changed in 2.1.0

- **Every piece is priced by its own stats.** A sniper with 101 attack and 16% crit is not the same goods as one with 130 and 20%, so a row's value is now the median of the last 7 days' sales of the same item whose stats sit next to the piece's: within a tenth of each stat's roll range ("same stats", three sales or more), else within a quarter ("similar stats", five or more). Each stat is measured against its own range, so one crit point weighs as much as several attack points. The span of the matched sales is printed on the row (`5 sales · atk 101–106 · crit 16% · 7 d`) and Details add their price range and the median time from listing to sale.
- **FLIP rests on those sales only.** A listing earns FLIP when pieces with these stats sold for the threshold or more above its price. The item's any-stats median and the game's average are still shown as a fallback, but neither earns a tag.
- **Every item on the page gets its sales read**, the grid's item first, 7 days back (ten pages of 100 at most), cached five minutes; nothing needs to be selected any more.
- **Weapon rows read correctly.** Live rows print the attack, the crit and the durability in that order (`101`, `16%`, `100%`), and armour its one stat and the durability (`12%`, `100%`); the reader took the first percentage as durability, which misread every weapon and called precision gloves unreadable. It now takes the last percentage before the price as durability and every number before it as a stat. Confirmed against two live rows.
- **Listed peers.** Details name how many other listings of the same stats are on the page and the cheapest of them.

## What changed in 2.0.0

- **One bar instead of two panels.** On the equipment market the extension now adds a single slim bar above the grid: brand, quote freshness, the live counts (snipes, flips, rows) and three tabs, **Market**, **Craft**, **Ledger**. Nothing is open by default, so the game's grid stays where it was.
- **Every offer gets a value, without selecting it.** Each row carries one line: the tag, the scrap profit with its ROI, and the piece's value (in 2.1.0: by its own stats, see above), with the game's own average price for that item (`gameStat.getEquipmentAvgByCode`, the "Current value" the game prints, read for all 36 items in one call every 10 minutes) as the fallback. "resale · select this item" is gone.
- **FLIP.** A second tag next to SNIPE: the value sits at least the FLIP threshold (default 10%) above the price. SNIPE outranks it. PASS replaces ABOVE TARGET.
- **The craft board.** The Craft tab is one row per tier: the cost of a random craft at the observed scrap and steel asks, its expected value over the six slots' averages at the game's odds, the best slot to choose and the ROI either way. Open a tier for its six slots, the recipe, the chosen-slot cost and what a bad roll really costs once it is scrapped. The 36-cell matrix that read "no fills", the batch, the target ROI, the ceilings, the listing scenarios and the recipe overrides are gone.
- **One ledger, observed.** The Ledger tab replays your own crafts from the game's feed with your key: every craft of the last 7 days with its roll, its cost at the craft day's average scrap and steel prices, whether it is still yours, sold or scrapped, and what its roll clears at now. The manual craft ledger (typed entries, export, import) is removed; what it stored stays in the browser untouched.
- **The feed walk fixed.** Sales and dismantles are now walked back to the oldest craft in the window instead of being cut at 500 rows. An active trader makes about 100 market rows every 3.5 hours, so the old cap covered 17 hours and a piece sold earlier than that showed as held forever.
- **The community ledger site is gone.** `warera-prices.web.app` answers "Site Not Found" since early October 2026. The extension never called it; the method it was checked against on 2026-10-05 is recorded in [docs/GAME-FACTS.md](docs/GAME-FACTS.md) §10 and is the extension's own now.
- **Settings.** Two thresholds (SNIPE ROI, FLIP gap), the modules, and under Advanced the refresh interval, the case drop policy, how you craft (for the ledger's steel fee) and an optional player id.

## Install or update

Requires Chrome 105+ or a compatible Chromium browser.

1. Download or clone this repository and select the branch/version you intend to test.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked** and select the `extension` folder.
3. Open the WarEra Plus settings from its toolbar icon. Paste your own API key and **Save**. **Test** is a separate explicit action; saving does not automatically call the API.
4. Reload the WarEra page. The bar and the offer tags appear on the equipment market; cases on supported market/inventory views; travel estimates next to the nearest-case map entry.

For an existing unpacked install, update files in the **same extension folder**, reload the extension and then reload the game. Keep the original extension installation identity to preserve its settings.

Do not publish or merge a release before completing the [manual checklist](docs/RELEASE-CHECKLIST.md).

## Offer tags

| Tag       | Meaning                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| SNIPE     | The scraps the piece dismantles into, sold at the observed bids, beat its price by at least the minimum ROI |
| FLIP      | Pieces with these stats sold in the last 7 days for at least the FLIP threshold above its price             |
| NEAR MISS | A scrap loss within an explicitly negative minimum ROI; never a profitable label                            |
| PASS      | Neither                                                                                                     |
| NO QUOTE  | No scrap quote, unreadable rarity or price, or too little observed bid depth                                |
| READING   | The first scrap quote is still being read                                                                   |
| STALE     | The quote is older than the refresh interval or the last read failed; no tag                                |

Scrap profit is `quoted scrap proceeds − displayed purchase price`; proceeds walk descending bid levels for the whole dismantle quantity (6 / 18 / 54 / 162 / 486 / 1458 scraps by rarity) and are never the top bid multiplied past the observed depth. The market tax is the buyer's and the seller receives the listing, so displayed prices get no adjustment.

**Sells for.** Every item on the page has its sales read (ten pages of 100 at most, 7 days, cached five minutes). A row's value is the median of the sales whose stats sit within a tenth of each stat's roll range of the piece's (three or more), else within a quarter (five or more); the matched sales' stat span is printed on the row. With neither, the item's any-stats median (five or more) or the game's average is shown, and no tag rests on it. A weapon is matched on its attack and its crit, an armour piece on its one stat.

**Details** (the ▸ button, a real button: keyboard, `aria-expanded`) hold the dismantle walk, the piece's stats, the sales evidence (the matched sales' price range, the median time from listing to sale, the item's pace, the price's percentile among the matched sales), the other listings of the same stats on the page and the cheapest of them, the stat rank among listed peers and the quote age. The rest of the line is the row's: clicks on it fall through to the game as before.

## Craft

The Craft tab prices one craft per tier from live quotes: the tier's scraps and the steel fee walked through the observed asks (the game's recipe, [docs/GAME-FACTS.md](docs/GAME-FACTS.md) §3: scraps equal to the tier's scrap value, steel 1 / 2 / 4 / 8 / 16 / 32, doubled for a chosen slot) against the game's average price per item. Random EV weights the six slots at the game's odds (30% weapon, 14% each armour slot) and is withheld while any slot lacks an average. The best chosen slot is the one with the highest average. A tier opens to its slots, the chosen-slot cost and the reroll loss: a crafted piece is at 100% and dismantles back into the tier's whole scrap ladder at the bid, only the steel and the spread are gone. Expected values, not promises.

## Ledger

The Ledger tab reads your own account off the page (the inventory and skills links), or the player id set in Advanced settings, and replays the feed store the worker keeps for it: your crafts, your market rows on both sides and your dismantles, 30 days at most, polled every minute while the equipment market is open. Every piece you got is one line: crafted (cost = the recipe at the craft day's average scrap and steel prices from `itemTrading.getItemTrading`, with the random-craft steel fee unless "How you craft" says chosen slot) or bought (cost = the price paid); its fate is your later sale of that item id (with the time it waited listed) or a dismantle (the scraps back at the day's average); a held piece is priced by the sales of its own stats, as the rows are. _Result_ sums what was sold or scrapped in the window against its cost; pieces whose acquisition is older than the store count by their proceeds only and are named. _Crafted_ and _Bought_ count the window's acquisitions and how many already sold; _Held now_ prices everything still yours. Days are your local days. Today or 7 days; the bar's head carries today's result whatever tab is open.

## Cases and travel

Unchanged from 1.4.1. SELL / OPEN EV / UNCERTAIN follow the drop policy in Advanced settings; the wooden model carries floor/round bounds; travel assumes 10 stamina or 2 oil per region per leg and never reads your stamina. Details in [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md).

## Refresh, privacy and safety

The scrap book refreshes every 30 seconds by default (10–600 configurable). Case and resource books refresh after 60 seconds, an item's sales after 5 minutes (7 days, ten pages of 100 at most, every item on the page), the game's average prices after 10 minutes, your own feed every minute while the equipment market is open (one page per feed when nothing is new). Hidden tabs request nothing and render nothing until they are shown again. API caches and active requests are shared by the background worker across tabs. Manual refresh does not bypass server cooldowns.

The key is stored locally in extension storage restricted to trusted extension contexts. Content scripts receive public preferences and data, not the key. API requests send it only to `api2.warera.io`, omit cookies/credentials and refuse redirects. There is no analytics or third-party backend. Local storage also holds preferences, bounded market, sales and averages caches, and the feed store of your own transactions (30 days, 3,000 rows a feed, kept across key changes); it is not an encrypted secret vault.

The DOM adapter reads existing offer prices, item IDs, borders, map labels and the tax notice. Unknown or changed markup must fail closed. The interface is in English; localization is not implemented.

## Development

Use Node 24 (the `engines` field; CI runs 24):

```sh
npm ci --ignore-scripts
npm run check
```

Individual commands: `npm test`, `npm run lint`, `npm run typecheck`, `npm run validate`, `npm run format`.

Reproducible screenshots and the browser loader benchmark (needs Playwright with its Chromium; point `PLAYWRIGHT_MODULE` at the module when it is not resolvable):

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/screenshots.mjs --before /path/to/old/extension
node scripts/bench-loader.mjs --before /path/to/old/extension   # jsdom diagnostic, no layout cost
```

Both run against `fixtures/market.html`, a synthetic stand-in for the equipment market, with a mock runtime (no API, no key). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for module responsibilities and test boundaries. Synthetic DOM tests cover lifecycle and mutation behavior, not live browser layout or the real page's markup.

## Kratko uputstvo

WarEra Plus je novo ime postojeće ekstenzije (ranije WarEra Lens i Scrap Sniper); repozitorijum, podešavanja i sačuvani ključ ostaju isti. Ažuriraj postojeći `extension` folder, klikni Reload u `chrome://extensions`, pa osveži igru.

Na tržištu opreme stoji jedna traka sa tri kartice: **Market** (cene otpada po retkosti i prodaje izabranog predmeta), **Craft** (šta košta i koliko vredi izrada po tieru, nasumično ili sa izabranim slotom) i **Ledger** (tvoje transakcije iz feeda igre, čuvane 30 dana i čitane svakog minuta dok je tržište otvoreno: šta si napravio ili kupio, po čemu, da li se prodalo ili rastavilo i za koliko, današnji rezultat; u zaglavlju trake stalno stoji današnji rezultat). Svaka ponuda nosi jedan red: oznaku (SNIPE kad otpad vredi više od cene, FLIP kad su se komadi sa istim statovima u poslednjih 7 dana prodavali za zadati procenat skuplje), profit od rastavljanja i po čemu se takav komad prodaje (medijana prodaja istih statova, u redu piše i raspon statova tih prodaja; prosek iz igre je samo rezerva i nikad ne daje oznaku). Prodaje se čitaju za sve predmete na strani, ništa ne mora da se bira. Porez plaća kupac, prodavac dobija listiranu cenu.

Pre korišćenja proveri aktuelna pravila igre i ponašanje na svom ekranu prema [kontrolnoj listi](docs/RELEASE-CHECKLIST.md). Ekstenzija ne izvršava transakcije niti klikće kontrole igre.

## License

MIT. See [LICENSE](LICENSE).
