# WarEra Scrap Sniper

A Chrome extension for [WarEra](https://app.warera.io) that shows, right on the
equipment market, what every listed piece of gear is worth as scrap and
highlights the offers priced under that value.

It helps you decide. It never buys, never clicks, never touches your session.
It talks to the game's API only with **your own API key**, never without one.

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

**A settings page** behind the toolbar icon: your API key (with a Test button
that tells you whether the API accepted it), the min margin and how often the
scrap price is read.

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

## Install

1. Get the files: `git clone https://github.com/AlexQDE/warera-scrap-sniper.git`,
   or **Code → Download ZIP** on GitHub and unzip it.
2. Open `chrome://extensions`, switch on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder (the one that
   contains `manifest.json`).
4. Click the Scrap Sniper icon in the toolbar (pin it if it is hidden behind
   the puzzle-piece button), paste your API key and press **Save**. The page
   tests the key against the API and tells you whether it was accepted.
5. Open WarEra → Market → the equipment tab. The bar appears under the
   "Taxed price" notice.

Works the same way in Edge, Brave and other Chromium browsers.

**Updating:** pull or re-download, then click the ↻ (reload) icon on the
extension's card in `chrome://extensions`. Your settings stay.

### Your API key

Create the key in the game, under your account settings, and paste it into
the extension's settings page. Nothing works without it: the extension makes
no keyless requests. Without a key the toolbar shows a notice with an
**Open settings** button instead of any numbers.

The key is stored in the browser's extension storage on your computer and is
sent only as the `x-api-key` header to `api2.warera.io`. The page you are
looking at never sees it: only the extension's background worker does.

One thing worth knowing: the API does not refuse a wrong key, it answers as
if no key were sent. Scrap Sniper detects that (the answer comes with the
keyless rate limit), drops the data and tells you the key was not accepted.

## Using it

- **Filter by item.** Click a tile in the game's own grid (for example the
  mythic weapon) and the list narrows to that item; the verdicts follow.
- **Min margin.** Only offers at least this many percent under their scrap
  value get the green outline. Use the − and + buttons (5% steps) or type a
  number. A negative value shows near misses too.
- **Load more.** New rows get their verdict automatically.
- **Collapse** the bar with the ▾ button; the setting is remembered.

The scrap price is read every 30 seconds by default (one request, shared
between your open tabs; your key allows 500 a minute). Change the interval in
the settings.

## Optional: the local dashboard

A page and a terminal table for watching the scrap price through the day
without the game open, with the same per-rarity table, a listing checker and
a bid/ask chart. Needs [Node.js](https://nodejs.org) 18 or newer.

```
npm install
node dashboard/scrapdash.mjs          # opens on http://127.0.0.1:8765
node dashboard/scrapdash.mjs --once   # one table in the terminal, then exit
```

The first run asks for your API key and saves it to a `.env` file next to
`package.json` (ignored by git) so you never edit a file by hand. Delete
`.env` to be asked again. The dashboard, like the extension, makes no
keyless requests.

Flags: `--port 9000`, `--interval 30` (seconds between reads, minimum 5),
`--once`. History is appended to `data/scrap-ticks.ndjson` (ignored by git).

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

- `extension/manifest.json`, `content.js`, `content.css`: the toolbar and the verdicts
- `extension/background.js`: holds the key, reads the scrap book
- `extension/popup.html`, `popup.js`: the settings page
- `extension/lib/api.mjs`: the one API call and the accepted-key check
- `extension/lib/ladder.mjs`: the scrap ladder and the dismantle yield
- `extension/lib/scraplib.mjs`: the per-rarity table, the order-book summary,
  the listing margin
- `extension/lib/dom.mjs`: everything that reads the market page
- `dashboard/`: the optional local server and page

## Fair play and privacy

Read-only by construction. The extension performs no purchase, no click and no
form submission; it reads the scrap order book with your own key and the page
you already have open. It uses no cookies, no session, no analytics and no
server other than the game's own API. Its only stored data is your key and
your settings, in the browser's extension storage.

## Uputstvo (srpski)

**Instalacija:** skini repo (Code → Download ZIP ili `git clone`), otvori
`chrome://extensions`, uključi **Developer mode**, klikni **Load unpacked** i
izaberi folder `extension`. Klikni ikonicu Scrap Sniper u traci pregledača,
nalepi svoj API ključ i pritisni **Save**. Stranica proveri ključ i kaže da li
ga je API prihvatio.

**API ključ:** pravi se u igri, u podešavanjima naloga. Bez ključa ekstenzija
ne šalje nijedan zahtev, samo pokaže obaveštenje sa dugmetom za podešavanja.
Ključ ostaje u pregledaču i šalje se samo igrinom API-ju.

**Šta gledaš:** pločice po retkosti su scrap vrednost (broj scrap-ova × cena
scrap-a, najniža prodajna), blok na svakoj ponudi poredi tu vrednost sa cenom
kakva piše. Zeleni okvir i SNIPE znače da je ponuda ispod scrap vrednosti.
"Min margin" određuje koliko posto ispod mora da bude.

**Dashboard** (opciono, treba Node 18+): `npm install`, pa
`node dashboard/scrapdash.mjs`. Pri prvom pokretanju pita za ključ i sam ga
sačuva u `.env`; ništa se ne kuca ručno u fajlove.

## License

MIT. See `LICENSE`.
