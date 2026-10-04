# WarEra Plus architecture

The extension has no runtime dependencies or build step. Node tooling is development-only. Keep page readers separate from pricing models and privileged I/O.

| Layer          | Modules                                                                                                                   | Responsibility                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Privileged I/O | `background.js`, `controller.mjs`, `api.mjs`, `flight.mjs`                                                                | Verify senders, protect the key, validate API data, serialize cache and ledger writes, share in-flight requests and cooldowns           |
| Models         | `quality.mjs`, `cases.mjs`, `ladder.mjs`, `sales.mjs`, `resale.mjs`, `offers.mjs`, `craft.mjs`, `ledger.mjs`, `items.mjs` | Pure pricing, probability, depth, freshness, resale evidence, stat readability, craft maths and ledger rules                            |
| Adapter        | `craftdata.mjs`                                                                                                           | Where the Craft Desk's recipes, prices, outcome distributions and tax rate come from (existing data, manual inputs, fixtures), labelled |
| Lifecycle      | `content.js`, `app.mjs`, `scheduler.mjs`                                                                                  | Bootstrap, visibility, SPA discovery, scoped observers, coalesced rendering and cleanup                                                 |
| Presentation   | `equipment.mjs`, `craftdesk.mjs`, `casesview.mjs`, `ui.mjs`, `format.mjs`, `content.css`                                  | Explain estimates, escape strings, preserve keyboard focus and carets, avoid unchanged DOM writes                                       |
| DOM adapter    | `dom.mjs`                                                                                                                 | Read the game's current markup; cache per-row reads; fail closed when an item, price or stat is ambiguous                               |
| Preferences    | `settings.mjs`, `popup.js`                                                                                                | Whitelisted public preferences (including craft recipes); trusted popup handles key entry                                               |

## Data contracts

`parseBook` validates both order sides, aggregates duplicate price levels and sorts bids descending / asks ascending. A depth quote requires the entire requested quantity. An empty side is valid data but cannot fund a nonzero quote. The API's returned order count reaching its cap is explicitly tracked. Observed liquidity is neither reserved nor guaranteed to remain available.

Cache schema 2 includes an ISO `at` timestamp. Averages additionally carry per-item `times` and `failures`: a failed item keeps its previous value and timestamp, is excluded from fresh resale estimates, and does not refresh the whole cache timestamp. A zero average means no historical price, not a zero-valued item.

Equipment TTL is configurable (10–600 seconds, default 30). Case and resource books use 60 seconds, sales 180 seconds, averages 600 seconds. Old quotes can be displayed with stale status but cannot generate action labels. A failed manual refresh also pauses labels until a usable fresh result arrives.

**Resale evidence** (`resale.mjs`): `comparableFills` keeps positive, dated fills of the same code inside the window, within ±10 durability when the offer's own durability is known and the fills carry one. `resaleEstimate` returns `none` when nothing was read, `insufficient` below `MIN_RESALE_SAMPLE` (5) with the count and the observed range, and `ok` with the median, low–high and the MAD spread; quartiles appear at `MIN_PERCENTILE_PEERS` (8). `percentileRank` needs eight valid peers. The two thresholds are never coupled.

**Offer dimensions** (`offers.mjs`): `readStats` parses durability (`NN%`) and the stat value from a row's visible lines, excluding the price line before BUY, and names its reason when it fails. `offerDimensions` reports `stats`, `market`, `freshness` and `resale` independently; `summarizeOffers` counts readable rows without reference to quotes or sales.

**Craft maths** (`craft.mjs`): prices snap to the 0.001 tick (`roundToTick`, float-noise tolerant). `inputCost` leaves the total unknown when a used input has no price. `buyWays`/`acquisition` price a batch at the walked asks (no price past the observed depth) and at the best bid (join or front of queue). `proceeds` applies the market tax once: deducted from the seller by default, or added for the buyer. `craftEV` requires a distribution (fractions summing to one) and is `unavailable` with the covered share when an outcome has no value. `breakEven` solves the input ceilings for a target ROI with the reason when none exists.

**Ledger** (`ledger.mjs`): entries are validated field by field (`normalizeEntry`); a sale needs proceeds; a crafted piece has no listing; texts are bounded; the list is capped at 500. `summarize` realizes profit on sold entries with a known basis only and keeps open pieces as labelled estimates. Export is a `craft-ledger` JSON document; import merges by id with the newer `updatedAt` winning and counts skipped entries. The worker stores it under `craftLedger` through `ledgerGet`/`ledgerSet` (content callers allowed; validated, bounded, kept across key changes and cleanup).

**Preferences** add `craft`, `craftCollapsed`, `craftBatch`, `craftTargetPct`, `taxPct` (null = read the page notice, else none) and `craftRecipes` (code → `{ scraps, steel }`, validated).

## Request and account lifecycle

Single-flight identity is resource + item + account generation, never the force flag. All callers share the same active read, including manual refresh. Writes and key changes are serialized. An old-key response cannot overwrite a new account's cache. Display preference revisions do not invalidate account data; a changed key or an explicit re-save after rejection increments `authRevision` and clears account caches (not the ledger).

The worker remembers a rejected key across worker restarts. Saving a key explicitly clears rejection, including when the user re-saves the same corrected/renewed key. A server 429 hold is global and persisted in session storage. Transient resource failures get bounded exponential backoff with jitter; forced refresh does not bypass it.

Keys are stored in extension-local storage restricted to trusted extension contexts. Content messages only receive public preferences and `hasKey`/rejection state. Requests omit credentials, disable HTTP caching and refuse redirects. Errors redact the supplied key before returning to the page. This is local browser storage, not an encrypted password vault.

The content side keeps the fills of the last twelve items it read (`salesByCode`) so rows of other items keep their resale evidence; sales are requested only for the item selected in the grid or picked on the Craft Desk.

## UI lifecycle and performance

API reads stop while the tab is hidden. Average prices load when the relevant details are opened; selected-item sales load whenever an item is selected. Rendering uses scoped mutation roots, filters extension-owned mutations and coalesces native mutation bursts with a 100 ms scheduler. Unchanged markup is not written again. Age labels update without re-rendering the panel. Immutable case snapshots reuse calculated summaries; selected-item statistics and resale estimates are memoized.

Offer scans are scoped: rows are looked for inside the list container found by the previous scan, with a full-document scan when that container is gone, finds nothing, or every 30 s. `createRowCache` keeps each row's parsed lines, price, frame and border colour; the layout-forcing `innerText` is read again only when the row's native text changes, and the frame colour only on a full scan (a new cache epoch), so a theme change is still picked up. The tax notice and the grid frames are reused while connected. Per-row annotation HTML is rebuilt only when its memo key (verdict, quote time, threshold, sales snapshot, rank, Details state) changes. Measured on the 60-row fixture (`docs/perf/`): 40 bursts cost 139 ms instead of 210 ms in Chromium, `innerText` reads 0 instead of 5,000, `getComputedStyle` 1,440 instead of 8,640.

A light five-second heartbeat checks preference revisions, URL changes and freshness transitions. A 30-second discovery fallback catches replaced SPA containers or newly opened dialogs outside observed roots. This deliberately avoids patching the game's history or global JavaScript.

Dispose disconnects the observer, cancels timers, removes extension UI (equipment panel, Craft Desk, case strip, trip line) and restores picker visibility. The content bootstrap handles ordinary unload; persisted back/forward-cache pages keep their instance. A second content-script injection is stopped by the original `window.__scrapSniper` marker.

## Tests and extension safety

Run `npm run check`. Unit tests cover models (including the 5/8 resale boundaries, craft tick rounding and ceilings, tax semantics, EV over outcomes, ledger validation and merge), malformed envelopes, pagination, missing headers, escaped text and depth. Controller tests use injected storage, fetch and clock for races, cooldowns and the ledger store. jsdom tests cover SPA navigation, mutation storms, hidden tabs, settings updates, duplicate mounting, the Details control, independent readable-stat counts under sales errors, the Craft Desk and cleanup. They do not prove real Chrome layout, extension permission behavior, live API compatibility or the live page's row text; `scripts/screenshots.mjs` renders the synthetic fixture in headless Chromium for screenshots and the loader benchmark.

The strict JS/TypeScript check covers `quality`, `settings`, `format`, `items`, `resale`, `offers`, `craft`, `craftdata` and `ledger`. Expand this list as additional modules gain types; do not represent it as whole-project TypeScript coverage. ESLint checks all extension code and scripts. The manifest validator walks local module imports and ensures privileged modules are not web-accessible.

When adding a feature, start with a pure model and a fixture, add a controller resource only if necessary, then mount it through `app.mjs`. Never add the API key to the content state or call a transaction mutation endpoint.
