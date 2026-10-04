# WarEra Plus

Read-only decision support inside [WarEra](https://app.warera.io): buy, craft, sell, wait, or not enough evidence. Formerly **WarEra Lens**, originally **WarEra Scrap Sniper**; same extension, same settings and key.

The extension compares offers and estimates. It never buys, crafts, lists, opens a case or travels for you. It uses your own API key and has no runtime dependencies or build step.

## What changed in 1.7.0

The game knowledge the 1.6.0 build was missing, each fact with its provenance in [docs/GAME-FACTS.md](docs/GAME-FACTS.md).

- **Recipes shipped.** Every Craft Desk cell carries the game's recipe: the tier's scrap value in scraps (6 / 18 / 54 / 162 / 486 / 1458) plus a steel fee of 1 / 2 / 4 / 8 / 16 / 32, doubled because a cell is a chosen slot. A recipe you type overrides the shipped one for that item; **Forget override** returns to the game's table. No cell reads `no recipe` any more, and the invented `fixtures/recipes.json` is gone.
- **Random craft.** A seventh matrix column prices the random craft of each tier: half the steel, the slot picked by the game (30% weapon, 14% each armour slot), expected value over the six slots' sales estimates, `k/6 slots` until every slot has one. The detail of a chosen cell carries the same comparison.
- **Reroll floor.** A crafted piece is at 100% durability and dismantles back into the tier's whole scrap ladder; only the steel is gone. The detail says what a roll sent straight back to scraps costs, which is far less than the input.
- **Tax side corrected.** The market tax is the buyer's, at the buyer's own country's rate, and the seller receives the listing. The desk nets the listing to the seller and shows what a buyer in your country is shown; the break-even listing is the cost itself. The tax-notice parser now reads the live sentence ("All prices displayed include a 1% market tax from your country"), which 1.6.0 could not.

## What changed in 1.6.0

Built on the published 1.4.1 code. (A local 1.5.x with unpublished changes existed on the author's machine; it was not available to this branch, see [docs/DELIVERY-2026-10-04.md](docs/DELIVERY-2026-10-04.md).)

- **Equipment offers, redesigned.** Each offer carries one compact line: the verdict tag, scrap profit with ROI, a resale estimate from comparable completed sales, and a **Details** button (a real button: keyboard, `aria-expanded`). Native price and BUY stay untouched; clicks on the annotation's text fall through to the row as before, only its button and its Details text are the extension's. Details hold the dismantle walk, the resale evidence (sample, window, low–high, quartiles, spread, pace), the stat rank among listed peers and the quote age. Loading, failed, stale, insufficient and "select this item" states are spelled out instead of blanked.
- **Resale thresholds, fixed and tested.** Five comparable fills support the resale estimate (the median with its range); eight valid peers are needed before a percentile rank or a quick/patient quartile scenario appears. The two bars are separate constants with boundary tests at 4/5 and 7/8.
- **Readable stats counted independently.** How many rows read (durability and stat), whether a scrap quote exists, and whether it is fresh are three separate dimensions. A failed sales read changes the resale column only; the readable-stat count no longer drops to zero.
- **Settings page, responsive.** No fixed minimum width; verified at 320, 380 and 560 px. Common settings (key, decisions, modules) up front, everything else under **Advanced**.
- **Loader.** Offer rows are scanned inside the list container found last time (a full-page scan every 30 s or when the list is gone), each row's layout text and frame colour are read once per content change, and unchanged annotations are not rewritten. On the 60-row fixture, 40 mutation bursts cost 123 ms instead of 212 ms in Chromium, with layout-forcing text reads down from 5,000 to 0. Cancellation, freshness checks, the five-page sales cap and cleanup are unchanged.
- **Craft Desk (new).** A compact panel under the equipment panel: expected ROI by tier and slot, cost per craft and per batch, buying now at the asks against placing bids, expected value over the craft's random outcomes, break-even and target-ROI ceilings for the scrap price given the steel price and the other way round, listing guidance with quick/balanced/patient scenarios where the evidence supports them, and a personal craft ledger with JSON export/import. Recipes are entered from the game's craft screen; nothing is assumed.
- **Name.** WarEra Plus in every label and document. Storage keys, the extension identity and the repository name are unchanged.

## Install or update

Requires Chrome 105+ or a compatible Chromium browser.

1. Download or clone this repository and select the branch/version you intend to test.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked** and select the `extension` folder.
3. Open the WarEra Plus settings from its toolbar icon. Paste your own API key and **Save**. **Test** is a separate explicit action; saving does not automatically call the API.
4. Reload the WarEra page. Offer annotations and the Craft Desk appear on the equipment market; cases on supported market/inventory views; travel estimates next to the nearest-case map entry.

For an existing unpacked install, update files in the **same extension folder**, reload the extension and then reload the game. Keep the original extension installation identity to preserve its settings. The rename retains existing storage keys and migrates preferences; it does not rename the GitHub repository or create a new extension identity.

Do not publish or merge a release before completing the [manual checklist](docs/RELEASE-CHECKLIST.md).

## Equipment offers

| Signal       | Meaning                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------- |
| SNIPE        | Nonnegative snapshot scrap profit at the requested minimum ROI, with enough observed bid depth |
| NEAR MISS    | A loss within the explicitly negative ROI threshold; never counted as a profitable match       |
| ABOVE TARGET | The offer does not meet the requested threshold                                                |
| NO QUOTE     | No scrap quote, unreadable rarity or price, or insufficient observed bid depth                 |
| READING      | The first scrap quote is still being read                                                      |
| STALE        | The quote is older than the refresh interval or the last read failed; no action label          |

Scrap profit is `quoted scrap proceeds − displayed purchase price`; ROI is that profit over the displayed price. Proceeds walk descending bid levels for the whole dismantle quantity (6 / 18 / 54 / 162 / 486 / 1458 scraps by rarity); they are never the top bid multiplied past the observed depth. Displayed prices receive no additional tax adjustment.

**Resale** is the median of comparable completed sales of the same item in the last 72 hours: fills within ±10 durability of the offer when the fills carry a durability, all of them otherwise. It needs five comparable fills (`5 of 5 fills` is the bar; fewer shows the count and the observed range only). With eight, Details add the quartiles, the offer's price percentile among those fills and the quick/patient scenarios. Sales are read for the item selected in the market grid (five pages of 100 fills at most, cached three minutes); rows of other items show `select this item` until their sales have been read.

**Readable stats** counts rows whose own durability and stat value parsed. The stat percentile among listed peers of the same item needs eight peers. The row reader was written against synthetic fixtures; see the checklist for the live check.

## Craft Desk

The desk opens with **Details** under the equipment panel. Every number names its source.

- **Recipe.** Every cell (tier × slot) carries the game's recipe: the tier's scrap value in scraps and twice the base steel fee, because picking the slot doubles the steel. If the game's craft screen ever disagrees, type the numbers and **Save recipe**; the override stays on this browser and **Forget override** returns to the table.
- **Random craft.** The last column of each tier prices crafting without choosing the slot: half the steel, the slot by the game's odds (30% weapon, 14% each armour slot), expected value over the six slots' sales estimates. It reads `k/6 slots` until every slot of the tier has an estimate.
- **Reroll floor.** A crafted piece is at 100% and dismantles back into the tier's whole scrap ladder; the steel is the only input that is gone. The detail prices that floor at the scrap bid, so you know what a bad roll really costs.
- **Prices.** Scrap and steel default to the best ask (what buying now costs) with their freshness; type your own to override. Batch, market tax and target ROI are kept in settings.
- **Buying now against bidding.** "Buy now at the asks" walks the observed ask depth for the whole batch and has no price when the depth does not cover it. "Place bids at the best bid" (and one tick ahead of the queue) is cheaper but fills only if a seller comes down to it, maybe never; the saving is shown as conditional.
- **Expected value.** The craft's outcomes are weighted by probability. With five or more comparable fills the single outcome is "sells like the last N fills" at their median, labelled as sales-weighted (it assumes a crafted piece sells like recent fills). Without them the EV is `unavailable`, never a guess. A desirable roll is one outcome among the others; it is not treated as the result.
- **Money words.** _Listing_ is the price you set, and what you receive: the market tax is the buyer's, at the buyer's own country's rate, and the price a buyer sees already includes it. _Cost_ is what the inputs cost. The rate shown is the one you set, else the one printed in the market's notice ("All prices displayed include a N% market tax from your country"), else none; it only changes what a buyer is shown.
- **Ceilings.** The most scraps may cost given the steel price (and the reverse) at break-even and at the target ROI, snapped down to the 0.001 tick, with the reason when there is none.
- **Listing guidance.** Balanced (median) needs five comparable fills; quick (lower quartile) and patient (upper quartile) need eight. Evidence lists the sample, window, capping, spread, last fill and the recent pace, which is the market's pace, not your listing's queue.

**Craft ledger.** Record a craft (prefilled from the current quotes, marked _inferred_ until you edit the prices, then _manual_), its result, list it, record the sale proceeds, keep or scrap it. Realized profit counts recorded sales with a known cost basis only; open pieces show an estimate labelled as such. Export and import are JSON files merged by id. Nothing is observed automatically; see the delivery report for why.

## Cases and travel

Unchanged from 1.4.1. SELL / OPEN EV / UNCERTAIN follow the drop policy in Advanced settings; the wooden model carries floor/round bounds; travel assumes 10 stamina or 2 oil per region per leg and never reads your stamina. Details in [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md).

## Refresh, privacy and safety

Equipment refresh defaults to 30 seconds (10–600 configurable). Case and resource books refresh after 60 seconds, selected-item sales after 3 minutes, average prices after 10 minutes. Hidden tabs request nothing. API caches and active requests are shared by the background worker across tabs. Manual refresh does not bypass server cooldowns.

The key is stored locally in extension storage restricted to trusted extension contexts. Content scripts receive public preferences and data, not the key. API requests send it only to `api2.warera.io`, omit cookies/credentials and refuse redirects. There is no analytics or third-party backend. Local storage also holds preferences, bounded market/sales caches, your craft recipes and your craft ledger (at most 500 entries); it is not an encrypted secret vault. The ledger survives key changes and cache cleanup and leaves the browser only through your own export.

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

Svaka ponuda nosi jedan red: oznaku, profit od rastavljanja sa ROI, procenu preprodaje iz uporedivih prodaja (potrebno je pet; za rang i kvartile osam) i dugme **Details** sa dokazima. Craft Desk ispod panela računa cenu po izradi i seriji, kupovinu odmah naspram postavljanja ponude, očekivanu vrednost preko slučajnih ishoda, granične cene otpada i čelika, i smernice za listanje. Recepti su ugrađeni (scraps = vrednost tiera u otpadu, čelik 1/2/4/8/16/32, dupliran kad biraš slot; nasumična izrada troši pola čelika), a svako polje možeš prepisati ako ekran za izradu kaže drugačije. Porez na tržištu plaća kupac po stopi svoje države, prodavac dobija listiranu cenu. Knjiga izrada je ručna evidencija sa izvozom i uvozom; dobit je ostvarena tek kad upišeš prodaju.

Pre korišćenja proveri aktuelne poreze, pravila igre i ponašanje na svom ekranu prema [kontrolnoj listi](docs/RELEASE-CHECKLIST.md). Ekstenzija ne izvršava transakcije niti klikće kontrole igre.

## License

MIT. See [LICENSE](LICENSE).
