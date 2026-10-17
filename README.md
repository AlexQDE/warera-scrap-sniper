# WarEra Plus

An unofficial, read-only companion for the browser game [WarEra](https://app.warera.io): what an offer on the equipment market is worth, what a craft or a case opening costs and returns, and what your own crafting, case opening and trading has made, from your whole history. It compares and estimates; it never buys, crafts, lists, opens a case or travels for you. Formerly **WarEra Lens**, originally **WarEra Scrap Sniper**: the same extension, settings and key.

[Changelog](CHANGELOG.md) · [Privacy policy](docs/PRIVACY.md) · [How it works](docs/ARCHITECTURE.md) · [Game facts it rests on](docs/GAME-FACTS.md)

WarEra Plus is not made, endorsed or supported by the makers of WarEra.

## What it does

- **On the equipment market**, one bar above the offers with three tabs (**Market**, **Craft**, **Ledger**), nothing open by default, and one line on every offer: its tag, the gain of its better route (scrap it or sell it) and what pieces of its stats sell for. Details (▸) show the evidence.
- **Craft**: per tier, what a craft costs at the market asks and what it is worth at the game's averages, a random craft against a sniper craft (the slot chosen, twice the steel).
- **Ledger**: your whole history, read once with your key and kept in this browser: every craft, case opening, buy and loot with its cost, what became of it and the result, for today, 7 days, 30 days or everything; every piece of the window in a list you can page through and filter by source; sniper crafts charged their real steel. **Eco** leaves gear worn in battle out of the results, **War** counts it.
- **In the game's own windows**: the craft and case windows say what crafting or opening is worth now, your results with that tier or case and what your last one gave; the sell form suggests a price; the item picker and Quick dismantle mark how you got each piece and list a weapon's pieces by crit and attack.
- **Cases and travel**: what opening each case is worth against selling it, on the market and in the inventory, and what a trip to the nearest wooden case costs.

## Install

**From the Chrome Web Store**: _link added once the listing is live_. Chrome 105 or a recent Chromium browser.

**From this repository** (unpacked, for testing a branch):

1. Download or clone the repository and check out the version to test.
2. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and select the `extension` folder.
3. Reload the WarEra page. For an update, replace the files in the same folder, press **Reload** on the extension, then reload the game (a reloaded extension does not replace the script in open tabs).

**Your API key (optional).** Open the settings from the toolbar icon, paste the key you create in the game's account settings and **Save**; **Test** checks it. Without a key the scrap prices, SNIPE, the case and craft values at the game's averages and the sell price from the asks work, from the API's free allowance. Sales by stats, FLIP, the Ledger, the sell price from sales and the picker's Crafted / Bought filters need the key: the API serves sales and your history only with one.

## How it reads the market

| Tag       | Meaning                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| SNIPE     | The scraps the piece dismantles into, sold at the observed bids, beat its price by at least the minimum ROI                        |
| FLIP      | Pieces with these stats sold in the last 7 days for at least the FLIP threshold above its price                                    |
| BID       | An auction (v0.27) in its last 10 minutes: the next bid pays by its scraps or its sales; the line says the most to bid, before tax |
| NEAR MISS | A scrap loss within an explicitly negative minimum ROI; never a profitable label                                                   |
| PASS      | Neither                                                                                                                            |
| NO QUOTE  | No scrap quote, unreadable rarity or price, or too little observed bid depth                                                       |
| READING   | The first scrap quote is still being read                                                                                          |
| STALE     | The quote is older than the refresh interval or the last read failed; no tag                                                       |

- **Scrap value**: the scraps a piece dismantles into (6 / 18 / 54 / 162 / 486 / 1458 by rarity) walked down the bids of the scrap book, never the top bid multiplied past the depth on record. The market tax is the buyer's, so displayed prices are compared as they are.
- **What a piece sells for**: the median of the newest sales (at most 50) of the same item whose stats sit within a tenth of each stat's range of the piece's (3 or more), else within a quarter (5 or more), over the last 24 hours, widened a day at a time to 7 days only while too few. Each of those sales is first brought to the piece's own stats by what each stat is worth on that item's market, read off its own sales, so a top roll is not priced down by the lower rolls it is grouped with. With none alike: the item's median (any stats) or the game's average, marked ≈, which never earns a tag.
- **A craft**: the tier's scraps plus the steel fee (1 / 2 / 4 / 8 / 16 / 32 by tier for a random craft, twice that for a sniper craft) at the market asks; a random craft's worth weighs the six slots at the game's odds (30% weapon, 14% each armour slot). Provenance of every number: [docs/GAME-FACTS.md](docs/GAME-FACTS.md).
- **The Ledger's costs**: a craft at that day's scrap and steel prices (the steel of a random craft or of a sniper craft, as each craft was made), a case at its price that day, a buy at what you paid, loot at nothing. The feed does not say whether a craft was a sniper craft: the extension notes the pick when you press CRAFT in the game's window, and for crafts it did not see takes six weapons or five of one armour piece in a row for sniper crafts. A held piece counts at what pieces of its stats sell for.

- **An auction** (the game's v0.27, read on its dev server): SNIPE and FLIP judge buying now, the BUY NOW amount, which includes your country's market tax; the card's start and max price do not. A bid in the last minute adds a minute, so a BID's ceiling is the most to bid, not the price you will pay. The game has no bid that rises by itself: a bid wins only if you are there at the end, so BID shows in an auction's last 10 minutes (sort by Ending soon); before that the most to bid is in Details. In Start an auction, with one piece picked: a start at what its scraps fetch and a max at what its stats sell for (else the game's estimate), inside the range the form allows.

Expected values, not promises; quotes are snapshots, not reserved liquidity.

## Privacy and permissions

Your key and your history stay in this browser. The key goes only to `api2.warera.io`, as the request header of the extension's own reads; cookies are never sent and redirects are refused. The extension has no analytics, no server of its own and no third party. It asks for `storage` and `unlimitedStorage` (settings, caches and your history, a few MB), reads `https://api2.warera.io/*` and runs on `https://app.warera.io/*` only. Details: [docs/PRIVACY.md](docs/PRIVACY.md).

## Development

Node 24 (CI runs 24); no runtime dependencies and no build step.

```sh
npm ci --ignore-scripts
npm run check     # lint, typecheck, manifest validation, tests, formatting
npm run package   # dist/warera-plus-<version>.zip, the store package
npm run build:dev # dist/dev: a copy for the game's dev server (dev.warera.io, apidev.warera.io), loaded unpacked
```

Development scripts (Playwright with its Chromium for the browser ones; point `PLAYWRIGHT_MODULE` at the module when it is not resolvable):

- `node scripts/jitter.mjs [--late]`: how fast the equipment market settles and how much it moves while it does, on the synthetic page `fixtures/market.html` with a cold worker's delays.
- `node scripts/backtest-prices.mjs`: the stat-matched value against what pieces are worth, on synthetic markets.
- `node scripts/screenshots.mjs` and `node scripts/store-assets.mjs`: screenshots of the synthetic page, and the store's screenshots and tile.
- `node scripts/bench-loader.mjs`: the row loader's DOM work in jsdom.

Synthetic pages and markets test behaviour, not the live game: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) lists the modules and what the tests cover.

## Releasing

Before a release, go through [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md) on the live game. Publishing to the Chrome Web Store, the listing text, the screenshots and the privacy answers: [docs/CHROME-WEB-STORE.md](docs/CHROME-WEB-STORE.md).

## Kratko uputstvo

WarEra Plus je neoficijalni pomoćnik za WarEra: samo čita i procenjuje, nikad ne kupuje, ne craftuje, ne listira i ne otvara kutije umesto tebe.

Na tržištu opreme stoji jedna traka sa tri kartice: **Market** (cene otpada po retkosti i prodaje izabranog predmeta), **Craft** (šta košta i koliko vredi izrada po tieru, nasumično ili kao sniper craft) i **Ledger** (cela tvoja istorija od početka profila: craft, kutije, kupovine i loot, svaki sa troškom, šta se prodalo ili rastavilo i za koliko, šta još držiš i koliko vredi; danas, 7 dana, 30 dana i ukupno). Spisak u Ledger-u sada drži sve komade iz izabranog perioda, 50 po strani, sa filterima Craft / Case / Buy / Loot.

**Sniper craft** (izabran slot u craft prozoru igre, dugme CRAFT umesto CRAFT RANDOM) troši duplo više čelika, scrap je isti. Igra ne beleži kako je craft napravljen, pa ekstenzija pamti izbor kad pritisneš CRAFT i vezuje ga za taj craft; za craftove koje nije videla (pre instalacije, sa drugog uređaja) 6 oružja ili 5 istih komada oklopa zaredom računa kao sniper craft. Takvi craftovi u Ledger-u nose ◎. Podešavanje: Advanced → How you craft (Detect, Always random, Always sniper craft).

Svaka ponuda nosi jedan red: oznaku (SNIPE kad otpad vredi više od cene, FLIP kad su se komadi sa istim statovima u poslednjih 7 dana prodavali za zadati procenat skuplje), dobitak boljeg puta i po čemu se takav komad prodaje. Vrednost je medijana prodaja istih ili sličnih statova, pri čemu se svaka prodaja prvo svodi na statove tvog komada (koliko stat vredi čita se iz prodaja tog predmeta), pa najbolji rolovi više nisu potcenjeni. Red ima stalnu širinu, pa cena i BUY dugme igre više ne skaču dok se podaci učitavaju.

**Aukcije (v0.27).** U sledećoj verziji igre tržište opreme postaje aukcija. Ekstenzija čita svaku karticu: SNIPE i FLIP gledaju BUY NOW (iznos na dugmetu, sa porezom tvoje zemlje), a nova oznaka **BID** kaže da se sledeća ponuda isplati i do koliko da licitiraš (pre poreza; ponuda u poslednjem minutu produžava aukciju za minut). Igra nema ponudu koja sama raste, pa ponuda pobeđuje samo ako si tu na kraju: zato se BID pojavljuje tek u poslednjih 10 minuta aukcije (sortiraj po „Ending soon“), a pre toga je najveća isplativa ponuda u Details. U „Start an auction“, sa jednim izabranim komadom, predlaže početnu cenu (koliko vredi otpad) i maksimalnu (za koliko se prodaju isti statovi, inače procena igre); **use** upisuje obe, aukciju pokrećeš ti. Za dev server: `npm run build:dev` pa učitaj `dist/dev`.

Ključ (API key) je opcion: bez njega rade cene otpada, SNIPE i procene kutija i crafta; prodaje po statovima, FLIP i Ledger traže ključ. Ključ i istorija ostaju u ovom pregledaču; ključ ide samo na `api2.warera.io`. Pre objave proveri ponašanje na živoj igri prema [kontrolnoj listi](docs/RELEASE-CHECKLIST.md).

## License

MIT. See [LICENSE](LICENSE).
