# Game facts the extension relies on

The 1.6.0 build was made without access to the game or to the research
repository behind this extension, so it shipped no recipes, guessed at the
tax side and called most rules "unverified". This file carries what that
research knows, with its provenance, so that no number in the extension has
to be typed in by the player or guessed by a contributor. Every fact carries a
tag: **MEASURED** (reproduced on the full market feed or in game), **CLIENT**
(read off the game's own client bundle or config), **CODEX** (the community
codex at warera.unikhorne.dev/codex, which cites its sources and dates) and
**UNVERIFIED** (an assumption the code still makes).

## 1. Items, codes and what a slot rolls

Six rarities, one weapon name per tier, five armour slots with the tier digit
in the code:

| Tier | Rarity    | Weapon | Armour codes                             |
| ---- | --------- | ------ | ---------------------------------------- |
| 1    | common    | knife  | helmet1, chest1, gloves1, pants1, boots1 |
| 2    | uncommon  | gun    | helmet2 … boots2                         |
| 3    | rare      | rifle  | helmet3 … boots3                         |
| 4    | epic      | sniper | helmet4 … boots4                         |
| 5    | legendary | tank   | helmet5 … boots5                         |
| 6    | mythic    | jet    | helmet6, chest6, gloves6, pants6, boots6 |

Each slot rolls one stat (weapons two): weapon = attack + critical chance,
helmet = critical damage, gloves = precision, chest and pants = armor, boots =
dodge. **CLIENT** (`gameConfig.getGameConfig` → `items[].dynamicStats`,
snapshot of 2026-09; identical to the codex tables).

## 2. Scraps, dismantling and durability

- **Scrap ladder** (what a piece dismantles into at 100% durability): common
  6, uncommon 18, rare 54, epic 162, legendary 486, mythic **1458**.
  **MEASURED**: 17,269,842 real dismantle transactions reproduced with zero
  mismatches (August 2026). The codex prints 1460 for mythic; the audit says 1458. `lib/ladder.mjs` already carries this.
- **Yield at durability** `s` of `max`: `floor(full × (1 + 2s/max) / 3)`,
  the full ladder at 100%, exactly one third at 0% (a destroyed piece returns
  2 / 6 / 18 / 54 / 162 / 486; the operator measured those in game on
  2026-09-16). **MEASURED**.
- **Steel is never returned** by dismantling. **CLIENT** (the bundle
  decomposes the dismantle return as `craftCost/3` + a durability-scaled bonus
  and has no steel term).
- **Market listings are always at 100% durability** (editor's correction,
  2026-09-03). A durability filter on listed gear is therefore moot; the
  durability on a fill still matters for comparing resale evidence.
- Wear: 1% per hit on armour (a dodged hit costs nothing), 1% per hit on the
  weapon including misses. **CODEX** (controlled run of 164 hits,
  2026-09-16).

## 3. Crafting recipes

A craft consumes **scraps equal to the scrap ladder of the output tier** and
a **steel fee** that the transaction feed does not record.

| Rarity    | Scraps | Steel, random slot | Steel, chosen slot |
| --------- | ------ | ------------------ | ------------------ |
| common    | 6      | 1                  | 2                  |
| uncommon  | 18     | 2                  | 4                  |
| rare      | 54     | 4                  | 8                  |
| epic      | 162    | 8                  | 16                 |
| legendary | 486    | 16                 | 32                 |
| mythic    | 1458   | 32                 | 64                 |

- Scraps: **MEASURED**, 534,037 of 534,037 June 2026 `craftItem` rows carry
  exactly the output tier's ladder as the input (code `scraps`, money 0,
  output state 100).
- Steel, random: **CLIENT**, `craftCostSteel = {1, 2, 4, 8, 16, 32}` in the
  bundle.
- Steel, chosen slot: **CODEX** (verify level "official"): the craft menu
  says choosing the slot costs ×2 steel, scraps unchanged. Cross-check: at the
  2026-09-16 market a mythic craft computed 381 g random and 438 g chosen;
  the operator read 378 and 436 in game the same evening.
- A **random craft** returns a weapon in about 30% of cases and each of the
  five armour slots in about 14% (2,200 crafts of five heavy crafters,
  **CODEX**; the game config's `loot.weaponChancePercent` is also 30).
- The recipe is the same for every slot of a tier. There is no recipe table
  in the game config; the numbers above are the whole table.

Consequences for the Craft Desk:

1. Every tier × slot cell has a recipe: ladder scraps + the **chosen-slot**
   steel. No cell should read "no recipe"; the player's own entry may still
   override the shipped one.
2. A random craft of a tier is a distribution over six codes (0.30 weapon,
   0.14 each armour slot) at half the steel. The existing `craftEV` already
   takes such a distribution; it is "unavailable" until every slot of the
   tier has a sales estimate, which is the honest answer.
3. **The reroll floor.** A bad roll dismantled at 100% returns all its
   scraps; the steel is the only sunk cost of an attempt. The worst case of a
   craft is therefore `scraps × scrap bid` back and `steel × steel price`
   lost, not the whole input cost.
4. Codex reading of September 2026 prices, for orientation only (re-price
   live): mythic random cost 381 g against results worth, averaged over
   every roll, jet 453, boots 440, gloves 380, helmet 370, pants 361, chest 346. Choosing the slot never paid for a seller at those prices (legendary
   boots gained 23.89 g for 27.17 g extra steel; a jet 51.26 for 54.34); it
   flips when steel falls below 1.60 g (jet) or 1.49 g (legendary boots).

## 4. Stat ranges per item (the roll)

`gameConfig.getGameConfig` → `items[].dynamicStats`, **CLIENT**, matching the
codex tables (which add a 260-profile live verification). The holes between
tiers are intentional, so a stat value maps back to its rarity unambiguously.

| Code             | Stat              | Range           |
| ---------------- | ----------------- | --------------- |
| knife            | attack / crit %   | 21–40 / 1–5     |
| gun              | attack / crit %   | 51–60 / 6–10    |
| rifle            | attack / crit %   | 71–90 / 11–15   |
| sniper           | attack / crit %   | 101–130 / 16–20 |
| tank             | attack / crit %   | 141–170 / 26–35 |
| jet              | attack / crit %   | 221–300 / 41–50 |
| helmet1          | criticalDamages   | 1–15            |
| helmet2          | criticalDamages   | 16–30           |
| helmet3          | criticalDamages   | 31–50           |
| helmet4          | criticalDamages   | 71–90           |
| helmet5          | criticalDamages   | 91–110          |
| helmet6          | criticalDamages   | 121–150         |
| chest / pants 1  | armor             | 1–5             |
| chest / pants 2  | armor             | 6–10            |
| chest / pants 3  | armor             | 11–15           |
| chest / pants 4  | armor             | 21–30           |
| chest / pants 5  | armor             | 36–50           |
| chest / pants 6  | armor             | 56–70           |
| gloves / boots 1 | precision / dodge | 1–5             |
| gloves / boots 2 | precision / dodge | 6–10            |
| gloves / boots 3 | precision / dodge | 11–15           |
| gloves / boots 4 | precision / dodge | 21–25           |
| gloves / boots 5 | precision / dodge | 31–40           |
| gloves / boots 6 | precision / dodge | 51–60           |

- The shape of the roll inside a range is **UNVERIFIED** (uniform is not
  confirmed). Do not weight outcomes by an assumed uniform roll.
- Price of a roll: the codex reports a jet at 293 attack / 47% crit selling
  around 560 g against a 453 g average, and that the crit factor's value is
  flat from 41 to 49 and jumps only at 50 (about +19%). **CODEX**.
- Fills from `transaction.getPaginatedTransactions` carry `item.skills`
  (the stat object) next to `item.state`; `api.mjs` currently drops it. That
  field is the way to price rolls against plain rolls.

## 5. The market tax

- The tax is the **buyer's**, at the buyer's own country's rate, and it goes
  to that country. **The seller receives the listed price either way.**
  **CODEX** (Markets; sourced to the client config and the wiki).
- Since **2026-09-09** the price shown on the equipment market **already
  includes** the buyer's tax. The notice above the list reads
  "All prices displayed include a 1% market tax from your country" (observed
  from a 1% country). Earlier builds printed "Taxed price".
- Consequences: the Craft Desk's `proceeds` should run in **added** mode (the
  seller nets the listing, the buyer in a c% country sees listing × (1 + c)),
  not the current "deducted" default. `dom.taxRateFromText` expects the
  number **after** "market tax"; in the live notice it comes **before**, so
  the parser returns null on the real page and must accept both orders.
- Whether `money` on a fill is the seller's listing or the buyer's taxed total
  is **UNVERIFIED** (the research repo compared fills as-is, 2026-09-16). The
  codex's rule (seller receives the listing; tax is a separate flow to the
  country) makes the listing the likelier reading. Label it.
- The equipment verdict keeps the editor's rule of 2026-09-03: scraps × the
  **highest scrap bid** compared **as-is** with the displayed price, no tax on
  either leg. Do not reintroduce a tax model there.

## 6. Cases

- Opening odds (**CODEX**, audited in the research repo on 543,747 /
  18,692 opens): slot 30% weapon / 70% armour; Case: common 62%, uncommon
  30%, rare 7.1%, epic 0.85%, legendary 0.04%, mythic 0.01%; Elite case:
  uncommon 50%, rare 32%, epic 15%, legendary 2.5%, mythic 0.5%. Expected
  scraps per open 14.7188 (case) and 67.499 (elite); `lib/cases.mjs` carries
  them.
- Wooden cases (v0.26.0, 2026-09-15): hourly roll of 25% base + the loot
  skill's value, at most 5 held, expire after 48 h, a 20-code resource pool.
  **CLIENT**. Travel costs 10 stamina per region hop when the bar covers the
  whole trip, else 2 oil per hop, never both (**CLIENT**, confirmed in game).

## 7. The page

- Rarity is readable **only from the item frame's border colour**. Since
  v0.26 the shades are the theme's 850 step: gray `#1C2E31`, emerald
  `#0A2C1C`, blue `#0E1D3F`, purple `#2A1745`, yellow `#2B2B12`, red
  `#390F10`; hover is the 700 step; the colour-blind theme paints epic pink.
  Grid tiles carry `id="item-code-selector-<code>"`, so the palette is
  calibrated off the page each scan (`dom.calibrateRarityBorders`).
- Item images: `<img alt={skinKey || itemCode}>`, so the alt is the skin name
  ("winterJet") when skinned and the plain code otherwise.
- Offer rows: 12 per page behind a translated "Load more"; the price is the
  line right before **BUY**; your own listing shows **DELETE** instead.
- Literal English anchors in every locale: "Buy", "market tax" / "Taxed
  price", the grid titles, the picker label "Item", "New item offer".
- The grid's "Current value" is `gameStat.getEquipmentAvgByCode`, a mean of
  recent sales, not the cheapest offer (jet 430.5 while the cheapest offer
  was 383.8 on 2026-09-03).
- Reloading an unpacked extension does not replace the content script in
  open tabs; the game page must be reloaded too, or the old script runs with
  a dead runtime.

## 8. The API

- `api2.warera.io` answers a wrong or missing key from the keyless bucket
  (`ratelimit-limit` 100) instead of refusing; an accepted key gets 500. So
  "accepted" means limit > 100; a missing header is unverified, not rejected.
- `tradingOrder.getTopOrders {itemCode, limit}`: limit capped at 100 per
  side, no cursor; a side returning exactly 100 rows is truncated.
- Undocumented but answering the key: `tradingOrder.getTopOrdersPerItemCode
{itemCodes, limit}` (every book in one call) and
  `gameStat.getEquipmentAvgByCode {itemCode}`. A tRPC GET batch (`?batch=1`)
  counts as one request.
- `transaction.getPaginatedTransactions {transactionType: "itemMarket",
itemCode, limit: 100}` is the per-item fills feed; a fill carries `money`,
  `createdAt`, `item.code`, `item.state`, `item.skills`. Busy commons hit the
  500-fill cap inside 72 h.
- `itemOffer.getItemOffers` (the open offers) is session-only: API keys get
  "API tokens cannot access this endpoint". Same for `user.getMe`,
  `userMapLoot.getMine`, `country.getMyCountry`.
- Some open offers are priced at 1e50 g as "not for sale" markers; ignore
  anything above 1e6 in value sums.

## 9. What this means for the next release

In order of value, each small enough for one commit with tests:

1. Ship the recipe table (section 3) as `lib/recipes.mjs`; the Craft Desk
   takes a player's entry first, else the shipped chosen-slot recipe, and
   labels the source. Drop `fixtures/recipes.json` (its numbers were
   invented) and the "no recipe" state for the 36 codes.
2. Add a per-tier **Random** column: half the steel, six outcomes at the
   slot odds, EV through the existing `craftEV`.
3. Show the reroll floor in the detail: scraps back at the scrap bid, steel
   lost per attempt.
4. Switch `proceeds` to the seller-nets-the-listing reading and make
   `taxRateFromText` read the live notice (section 5).
5. Carry `item.skills` on fills and show a stat's place in its range
   (section 4) in Details and in the ledger form.
6. Rewrite the "Crafting" paragraph of the release checklist and the README's
   Craft Desk section from this file.

Status: 1 to 4 and 6 shipped in 1.7.0 (`ladder.mjs` carries the table and
the odds, `craftdata.mjs` the shipped recipes, the overrides and the random
craft, `craft.mjs` the reroll floor; the desk passes the buyer-side tax mode
and the notice parser reads both word orders). 5 is open.

Separately, the author's local 1.5.2 (labelled stat reading in
`statsdom.mjs`, `market.mjs` skills, the bounded Load-more loader) is still
unmerged in the private repository; its row reader reads **labelled** numbers
only, which is the right answer to the checklist's open question about the
live row layout.
