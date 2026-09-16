# WarEra Lens architecture

The extension has no runtime dependencies or build step. Node tooling is development-only. Keep page readers separate from pricing models and privileged I/O.

| Layer          | Modules                                                                 | Responsibility                                                                                                     |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Privileged I/O | `background.js`, `controller.mjs`, `api.mjs`, `flight.mjs`              | Verify senders, protect the key, validate API data, serialize cache writes, share in-flight requests and cooldowns |
| Models         | `quality.mjs`, `cases.mjs`, `ladder.mjs`, `sales.mjs`, `items.mjs`      | Pure pricing, probability, depth, freshness and statistics                                                         |
| Lifecycle      | `content.js`, `app.mjs`, `scheduler.mjs`                                | Bootstrap, visibility, SPA discovery, scoped observers, coalesced rendering and cleanup                            |
| Presentation   | `equipment.mjs`, `casesview.mjs`, `ui.mjs`, `format.mjs`, `content.css` | Explain estimates, escape strings, preserve keyboard focus, avoid unchanged DOM writes                             |
| DOM adapter    | `dom.mjs`                                                               | Read the game's current markup; fail closed when an item or price is ambiguous                                     |
| Preferences    | `settings.mjs`, `popup.js`                                              | Whitelisted public preferences; trusted popup handles key entry                                                    |

## Data contracts

`parseBook` validates both order sides, aggregates duplicate price levels and sorts bids descending / asks ascending. A depth quote requires the entire requested quantity. An empty side is valid data but cannot fund a nonzero quote. The API's returned order count reaching its cap is explicitly tracked. Observed liquidity is neither reserved nor guaranteed to remain available.

Cache schema 2 includes an ISO `at` timestamp. Averages additionally carry per-item `times` and `failures`: a failed item keeps its previous value and timestamp, is excluded from fresh resale estimates, and does not refresh the whole cache timestamp. A zero average means no historical price, not a zero-valued item.

Equipment TTL is configurable (10–600 seconds, default 30). Case books use 60 seconds, sales 180 seconds, averages 600 seconds. Old quotes can be displayed with stale status but cannot generate action labels. A failed manual refresh also pauses labels until a usable fresh result arrives.

## Request and account lifecycle

Single-flight identity is resource + item + account generation, never the force flag. All callers share the same active read, including manual refresh. Writes and key changes are serialized. An old-key response cannot overwrite a new account's cache. Display preference revisions do not invalidate account data; a changed key or an explicit re-save after rejection increments `authRevision` and clears account caches.

The worker remembers a rejected key across worker restarts. Saving a key explicitly clears rejection, including when the user re-saves the same corrected/renewed key. A server 429 hold is global and persisted in session storage. Transient resource failures get bounded exponential backoff with jitter; forced refresh does not bypass it.

Keys are stored in extension-local storage restricted to trusted extension contexts. Content messages only receive public preferences and `hasKey`/rejection state. Requests omit credentials, disable HTTP caching and refuse redirects. Errors redact the supplied key before returning to the page. This is local browser storage, not an encrypted password vault.

## UI lifecycle and performance

API reads stop while the tab is hidden. Average prices and selected-item sales load when the relevant details are opened. Rendering uses scoped mutation roots, filters extension-owned mutations and coalesces native mutation bursts with a 100 ms scheduler. Unchanged markup is not written again. Age labels update without re-rendering the panel. Immutable case snapshots reuse calculated summaries; selected-item statistics are memoized.

A light five-second heartbeat checks preference revisions, URL changes and freshness transitions. A 30-second discovery fallback catches replaced SPA containers or newly opened dialogs outside observed roots. This deliberately avoids patching the game's history or global JavaScript. An observer-triggered scan still inspects the visible offer list; this is not a virtualized or strictly O(changed rows) renderer.

Dispose disconnects the observer, cancels timers, removes extension UI and restores picker visibility. The content bootstrap handles ordinary unload; persisted back/forward-cache pages keep their instance.

## Tests and extension safety

Run `npm run check`. Unit tests cover models, malformed envelopes, pagination, missing headers, escaped text and depth. Controller tests use injected storage, fetch and clock for races and cooldowns. jsdom tests cover SPA navigation, mutation storms, hidden tabs, settings updates and cleanup. They do not prove real Chrome layout, extension permission behavior or live API compatibility.

The strict JS/TypeScript check currently covers shared quality, preferences, formatting and item contracts. Expand this list as additional modules gain types; do not represent it as whole-project TypeScript coverage. ESLint checks all extension code and scripts. The manifest validator walks local module imports and ensures privileged modules are not web-accessible.

When adding a feature, start with a pure model and a fixture, add a controller resource only if necessary, then mount it through `app.mjs`. Never add the API key to the content state or call a transaction mutation endpoint.
