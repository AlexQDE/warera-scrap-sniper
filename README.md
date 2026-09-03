# WarEra Scrap Sniper

A Chrome extension for [WarEra](https://app.warera.io) that shows, right on the
equipment market, what every listed piece of gear is worth as scrap and
highlights the offers priced under that value.

It helps you decide. It never buys, never clicks, never touches your session.
No account, no token, no server of ours.

## What you get

**A toolbar** under the market's "Taxed price" notice:

- the live scrap price (lowest sell order on the scrap market) and the best bid,
  with the quantity resting at each
- six rarity tiles in the game's own colours: the scrap value of a common,
  uncommon, rare, epic, legendary and mythic piece
- how many offers on the page are under their scrap value, and which offer
  sits closest to it
- a **min margin** stepper, a refresh button and a collapse button

**A verdict block on every offer**, left of BUY:

- the scrap value of that piece and the gap to its price
- a meter showing how much of the price the scraps pay back
- the price as a multiple of its scrap value
- a green outline and a **SNIPE** tag when the offer is under its scrap value
- a gold **closest on page** tag on the offer nearest its scrap value

## The rule

```
scrap value = scraps × scrap price
```

- **scraps** per dismantle: 6 / 18 / 54 / 162 / 486 / 1458 for common /
  uncommon / rare / epic / legendary / mythic. Measured on 17.3 million real
  dismantles, zero exceptions.
- **scrap price**: the lowest sell order on the scrap market, read live.
- The result is compared with the gear price **exactly as the market shows
  it**. Nothing is added or taken off on either side.
- Market listings are always at 100% durability, so there is no wear term.

At a scrap price of 0.226 that gives 1.356 for a common piece and 329.508 for
a mythic one. Every gold amount is shown with three decimals, the market's own
precision, so you compare 1:1.

## Install the extension

No token or account needed.

1. Get the files: `git clone https://github.com/AlexQDE/warera-scrap-sniper.git`,
   or **Code → Download ZIP** on GitHub and unzip it.
2. Open `chrome://extensions`, switch on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder (the one that
   contains `manifest.json`).
4. Open WarEra → Market → the equipment tab. The bar appears under the
   "Taxed price" notice.

Works the same way in Edge, Brave and other Chromium browsers.

**Updating:** pull or re-download, then click the ↻ (reload) icon on the
extension's card in `chrome://extensions`.

## Using it

- **Filter by item.** Click a tile in the game's own grid (for example the
  mythic weapon) and the list narrows to that item; the verdicts follow.
- **Min margin.** Only offers at least this many percent under their scrap
  value get the green outline. Use the − and + buttons (5% steps) or type a
  number. A negative value shows near misses too.
- **Load more.** New rows get their verdict automatically.
- **Collapse** the bar with the ▾ button; the setting is remembered.

The scrap book is read every 30 seconds without any key (two requests a
minute, against a keyless limit of 100) and shared between your open tabs.

## Optional: the local dashboard

A page and a terminal table for watching the scrap price through the day,
with the same per-rarity table, a listing checker and a bid/ask chart. Needs
[Node.js](https://nodejs.org) 18 or newer.

```
npm install
node dashboard/scrapdash.mjs          # opens on http://127.0.0.1:8765
node dashboard/scrapdash.mjs --once   # one table in the terminal, then exit
```

Flags: `--port 9000`, `--interval 30` (seconds between reads, minimum 5),
`--once`. History is appended to `data/scrap-ticks.ndjson` (ignored by git).

### Your API key (optional)

The dashboard works without a key: keyless reads are allowed at 100 requests
a minute and it uses 3. A key raises the limit to 200. If you want that:

1. Copy the example file: `cp .env.example .env` (on Windows: `copy .env.example .env`).
2. Open `.env` and put your key after the equals sign:
   ```
   WARERA_API_KEY=paste-your-key-here
   ```
   The key is the one you generate in the game, in your account settings.
3. Start the dashboard again. It prints `using your API key` on startup.

`.env` is listed in `.gitignore`, so it cannot be committed by accident. Never
paste a key into an issue or a chat. The key is sent only as the `x-api-key`
header to `api2.warera.io`, and only by the dashboard: the extension never
sees it, because it never needs one.

## How the page is read

WarEra does not label offers with their rarity, so the extension reads:

- **rarity** from the border colour of the item tile (six known colours), or
  from the `?item=` code in the URL when the list is filtered to one item
- **price** from the line just before the BUY button in each row
- your own listing shows DELETE instead of BUY, so it is skipped

If the game changes its layout, a verdict turns amber ("rarity unreadable")
instead of guessing. Open an issue with a screenshot and it will be fixed.

## Development

```
npm install
npm test
```

- `extension/manifest.json`, `content.js`, `content.css`: the extension itself
- `extension/lib/ladder.mjs`: the scrap ladder and the dismantle yield
- `extension/lib/scraplib.mjs`: the per-rarity table, the order-book summary,
  the listing margin
- `extension/lib/dom.mjs`: everything that reads the market page
- `dashboard/`: the optional local server and page

## Fair play and privacy

Read-only by construction. The extension performs no purchase, no click and no
form submission; it reads the public scrap order book and the page you already
have open. It uses no cookies, no session, no analytics and no server other
than the game's own API. Its only stored data is your min-margin and collapse
setting, in the browser's extension storage.

## Uputstvo (srpski)

**Ekstenzija** (ne treba nikakav token): skini repo (Code → Download ZIP ili
`git clone`), otvori `chrome://extensions`, uključi **Developer mode**, klikni
**Load unpacked** i izaberi folder `extension`. Otvori Market, tab sa opremom:
traka se pojavljuje ispod obaveštenja "Taxed price".

**Šta gledaš:** pločice po retkosti su scrap vrednost (broj scrap-ova × cena
scrap-a, najniža prodajna), blok na svakoj ponudi poredi tu vrednost sa cenom
kakva piše. Zeleni okvir i SNIPE znače da je ponuda ispod scrap vrednosti.
"Min margin" određuje koliko posto ispod mora da bude.

**Dashboard** (opciono, treba Node 18+): `npm install`, pa
`node dashboard/scrapdash.mjs` i otvori `http://127.0.0.1:8765`, ili
`node dashboard/scrapdash.mjs --once` za tabelu u terminalu.

**API ključ** (opciono, samo za dashboard): kopiraj `.env.example` u `.env` i
upiši `WARERA_API_KEY=tvoj_kljuc`. Ključ se generiše u igri, u podešavanjima
naloga. `.env` je u `.gitignore` i nikad ne ide u repo. Bez ključa sve radi,
samo je limit 100 zahteva u minutu umesto 200, a dashboard troši 3.

## License

MIT. See `LICENSE`.
