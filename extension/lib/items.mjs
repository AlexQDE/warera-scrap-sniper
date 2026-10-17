// @ts-check
export const RARITIES = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "mythic",
];
export const WEAPONS = ["knife", "gun", "rifle", "sniper", "tank", "jet"];
export const SLOTS = ["helmet", "chest", "gloves", "pants", "boots"];
export const GEAR_CODES = Object.fromEntries(
  RARITIES.map((r, i) => [
    r,
    { weapon: WEAPONS[i], gear: SLOTS.map((s) => `${s}${i + 1}`) },
  ]),
);
export const ALL_GEAR_CODES = RARITIES.flatMap((r) => [
  GEAR_CODES[r].weapon,
  ...GEAR_CODES[r].gear,
]);
/**
 * v0.27 (dev, 2026-10-17): employees' tools, one family per kind of good, tier 1-6 like armour
 * (gameConfig items `type: "tool"`, `isTradable: false`, a production stat). They come out of toolboxes.
 */
export const TOOL_FAMILIES = [
  "sickle",
  "pickaxe",
  "skillet",
  "hammer",
  "flask",
  "caliper",
];
const TOOL_RE = new RegExp(`^(${TOOL_FAMILIES.join("|")})[1-6]$`);
/** @param {unknown} code */
export const isToolCode = (code) => TOOL_RE.test(String(code ?? ""));
/** The cases a v0.27 wooden case can drop instead of resources (client config `caseDrops`). */
export const CASE_DROP_CODES = ["case1", "case2", "toolbox"];
