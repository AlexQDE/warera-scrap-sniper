# WarEra Lens

Read-only equipment, case and travel insights inside [WarEra](https://app.warera.io). Formerly **WarEra Scrap Sniper**.

The extension helps you compare offers and estimates. It never buys, sells, opens a case or travels for you. It uses your own API key and has no runtime dependencies or build step.

## What changed in 1.4.0

- **Equipment:** depth-adjusted scrap proceeds, profit/ROI, SNIPE versus NEAR MISS, and an accurately named Best value label. Negative thresholds never turn a loss into SNIPE.
- **Cases:** separate sealed bids, expected opening proceeds, uncertainty bands and historical resale estimates. Missing data and stale quotes pause action labels.
- **Travel:** one-way / round-trip toggle, oil ask-depth pricing, separate sealed and expected-opened net values. Stamina is a requirement, not assumed free.
- **UI:** compact by default, responsive panels, explicit freshness, keyboard focus states, per-feature switches and optional detail views.
- **Reliability:** shared in-flight reads, validated responses, global server cooldowns, per-resource retry backoff, account-safe caches and retained per-item average timestamps.
- **Maintenance:** separate API/controller, models, DOM adapter and UI modules; lint, gradual strict type checks, regression tests and CI.

## Install or update

Requires Chrome 105+ or a compatible Chromium browser.

1. Download or clone this repository and select the branch/version you intend to test.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked** and select the `extension` folder.
3. Open the WarEra Lens settings from its toolbar icon. Paste your own API key and **Save**. **Test** is a separate explicit action; saving does not automatically call the API.
4. Reload the WarEra page. Equipment insights appear on the equipment market; cases on supported market/inventory views; travel estimates next to the nearest-case map entry.

For an existing unpacked install, update files in the **same extension folder**, reload the extension and then reload the game. Keep the original extension installation identity to preserve its settings. The rebrand retains existing storage keys and migrates preferences; it does not rename the GitHub repository or create a new extension identity.

Do not publish or merge a release before completing the [manual checklist](docs/RELEASE-CHECKLIST.md).

## Read the signals correctly

| Signal               | Meaning                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| SNIPE                | Nonnegative snapshot profit and requested minimum ROI, with enough observed scrap bids               |
| NEAR MISS            | A loss within the explicitly negative ROI threshold; never counted as a profitable match             |
| ABOVE TARGET         | The offer does not meet the requested threshold                                                      |
| STALE / NO QUOTE     | Old, missing or insufficient data; no active recommendation                                          |
| SELL / SELL vs scrap | Sealed bid clears the applicable opening model by at least 10%; battle case comparison is scrap-only |
| OPEN EV              | Expected opening proceeds clear the sealed bid by at least 10%; an individual opening can still lose |
| UNCERTAIN            | Inside the decision margin or wooden floor/round model band                                          |

Equipment ROI is `(quoted scrap proceeds − displayed purchase price) / displayed purchase price`. Proceeds walk descending bid levels for the whole dismantle quantity; they are not simply the top bid multiplied beyond available depth. The rarity ladder remains 6 / 18 / 54 / 162 / 486 / 1458.

Case EV weights possible outcomes, not guaranteed rewards. The wooden model carries floor/round quantity bounds. Battle-case signals use outcome-weighted scrap proceeds; average equipment resale is separately labeled and never substituted for missing prices. Quotes are snapshots, not reserved liquidity. No additional tax adjustment is applied; see the model assumptions in the [release checklist](docs/RELEASE-CHECKLIST.md).

Recent sales are requested for the selected item when equipment details are open. The window is 72 hours, capped at five pages of 100 fills; the panel names a capped sample. The inventory picker hides only positively identified nonmatching tiles and always offers Show all.

## Refresh, privacy and safety

Equipment refresh defaults to 30 seconds (10–600 configurable). Case books refresh after 60 seconds, selected-item sales after 3 minutes, and average prices after 10 minutes. Hidden tabs request nothing. API caches and active requests are shared by the background worker across tabs. Manual refresh does not bypass server cooldowns.

The key is stored locally in extension storage restricted to trusted extension contexts. Content scripts receive public preferences and data, not the key. API requests send it only to `api2.warera.io`, omit cookies/credentials and refuse redirects. There is no analytics or third-party backend. Local storage also holds preferences and bounded market/sales caches; it is not an encrypted secret vault.

The accepted-key check retains the original rate-limit-bucket heuristic. Missing verification headers produce an explicit unverified state; rejected keys pause reads until saved again. This release did not independently re-audit the live API or historical game-rule research.

The DOM adapter reads existing offer prices, item IDs, borders and map labels. Unknown or changed markup must fail closed. The interface is in English; localization is not implemented.

## Development

Use Node 24+:

```sh
npm ci --ignore-scripts
npm run check
```

Individual commands: `npm test`, `npm run lint`, `npm run typecheck`, `npm run validate`, `npm run format`.

The extension runs directly from `extension/`; development packages are not shipped to the game. See [architecture and data contracts](docs/ARCHITECTURE.md) for module responsibilities and test boundaries. Synthetic DOM tests cover lifecycle and mutation behavior, not live browser layout or FPS.

## Kratko uputstvo

WarEra Lens je novo ime postojeće ekstenzije; repozitorijum i sačuvani ključ ostaju isti. Ažuriraj postojeći `extension` folder, klikni Reload u `chrome://extensions`, pa osveži igru.

U podešavanjima sačuvaj sopstveni API ključ; Test se pokreće odvojeno. Paneli su podrazumevano sklopljeni. Details prikazuje dodatne procene i učitava potrebnu istoriju prodaja/proseke. Module možeš pojedinačno da isključiš.

SNIPE znači da ponuda zadovoljava prag i nije gubitnička prema trenutnoj dubini bidova. NEAR MISS je zasebno označen mali gubitak. STALE/NO QUOTE znači da nema dovoljno pouzdanih podataka za signal. EV je očekivana, ne zagarantovana vrednost. Povratno putovanje uključuje obe deonice; stanje stamine se ne čita.

Pre korišćenja proveri aktuelne poreze, pravila igre i ponašanje na svom ekranu prema [kontrolnoj listi](docs/RELEASE-CHECKLIST.md). Ekstenzija ne izvršava transakcije niti klikće kontrole igre.

## License

MIT. See [LICENSE](LICENSE).
