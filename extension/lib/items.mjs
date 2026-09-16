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
