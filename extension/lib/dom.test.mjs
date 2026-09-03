import { describe, it, expect } from 'vitest';
import {
  rarityFromBorder, rarityFromItemCode, parsePrice, isItemImageAlt, priceFromLines, verdict,
  closestIndex, fmtQty, slotFromAlt, targetFromCode, itemLabel, isPickerText, pickerDecision,
} from './dom.mjs';

// The inventory picker behind "New item offer" shows every item as a skin
// image whose name ends in the slot (dieselBoots, miamiHelmet, winterJet) inside
// a rarity-bordered tile; the market filter puts the item code in the URL.
describe('slotFromAlt', () => {
  it('reads the slot off the skin name', () => {
    expect(slotFromAlt('dieselBoots')).toBe('boots');
    expect(slotFromAlt('miamiHelmet')).toBe('helmet');
    expect(slotFromAlt('gsg9Pants')).toBe('pants');
    expect(slotFromAlt('winterJet')).toBe('jet');
    expect(slotFromAlt('1kSubRifle')).toBe('rifle');
    expect(slotFromAlt('miamiKnife')).toBe('knife');
  });

  it('is null for avatars, flags and unknown names', () => {
    expect(slotFromAlt('Nijntje avatar')).toBeNull();
    expect(slotFromAlt('Netherlands flag')).toBeNull();
    expect(slotFromAlt('')).toBeNull();
  });
});

describe('isPickerText', () => {
  it('recognises the picker dialog by its textContent, where "Item" runs straight into the first number', () => {
    // real textContent of the picker on 2026-09-03: no whitespace after the title
    expect(isPickerText('Item27050%430.5100%15633%148.8100%')).toBe(true);
    expect(isPickerText('Item\n270\n50%')).toBe(true);
    expect(isPickerText('  Item')).toBe(true);
  });

  it('rejects the outer offer dialog and anything else starting with Item-something', () => {
    expect(isPickerText('New item offerItemPriceWill be displayed')).toBe(false);
    expect(isPickerText('Items for sale')).toBe(false);
    expect(isPickerText('')).toBe(false);
  });
});

describe('pickerDecision', () => {
  const target = { slot: 'pants', rarity: 'uncommon' };
  it('shows a matching tile and hides a tile that is positively something else', () => {
    expect(pickerDecision({ slot: 'pants', rarity: 'uncommon' }, target)).toBe('show');
    expect(pickerDecision({ slot: 'pants', rarity: 'rare' }, target)).toBe('hide');
    expect(pickerDecision({ slot: 'boots', rarity: 'uncommon' }, target)).toBe('hide');
  });

  it('never hides what it cannot read: an unknown skin name or an off-palette border stays visible', () => {
    expect(pickerDecision({ slot: null, rarity: 'uncommon' }, target)).toBe('unknown');
    expect(pickerDecision({ slot: 'pants', rarity: null }, target)).toBe('unknown');
  });
});

describe('targetFromCode', () => {
  it('turns a market item code into the slot and rarity the picker should keep', () => {
    expect(targetFromCode('boots5')).toEqual({ slot: 'boots', rarity: 'legendary' });
    expect(targetFromCode('helmet1')).toEqual({ slot: 'helmet', rarity: 'common' });
    expect(targetFromCode('jet')).toEqual({ slot: 'jet', rarity: 'mythic' });
    expect(targetFromCode('gun')).toEqual({ slot: 'gun', rarity: 'uncommon' });
  });

  it('is null for anything that is not gear', () => {
    expect(targetFromCode('scraps')).toBeNull();
    expect(targetFromCode(null)).toBeNull();
  });
});

describe('itemLabel', () => {
  it('names gear the way a player says it', () => {
    expect(itemLabel('boots5')).toBe('legendary boots');
    expect(itemLabel('jet')).toBe('mythic jet');
    expect(itemLabel('nothing')).toBe('nothing');
  });
});

// Border colours read off app.warera.io/market/equipments on 2026-09-03 (grid
// tiles and offer-row tiles alike, getComputedStyle(...).borderColor).
describe('rarityFromBorder', () => {
  it('maps the six live tile borders', () => {
    expect(rarityFromBorder('rgb(150, 38, 40)')).toBe('mythic');
    expect(rarityFromBorder('rgb(129, 120, 45)')).toBe('legendary');
    expect(rarityFromBorder('rgb(94, 59, 145)')).toBe('epic');
    expect(rarityFromBorder('rgb(37, 78, 167)')).toBe('rare');
    expect(rarityFromBorder('rgb(43, 110, 68)')).toBe('uncommon');
    expect(rarityFromBorder('rgb(80, 112, 124)')).toBe('common');
  });

  it('tolerates a small palette shift and accepts rgba', () => {
    expect(rarityFromBorder('rgba(155, 40, 44, 0.9)')).toBe('mythic');
  });

  it('refuses a colour that is not near any tile border', () => {
    expect(rarityFromBorder('rgb(208, 221, 225)')).toBeNull();   // the avatar/flag tile
    expect(rarityFromBorder('rgba(0, 0, 0, 0)')).toBeNull();
    expect(rarityFromBorder('')).toBeNull();
  });
});

describe('rarityFromItemCode', () => {
  it('reads the tier digit on gear and names on weapons (gameConfig 2026-09-03)', () => {
    expect(rarityFromItemCode('helmet6')).toBe('mythic');
    expect(rarityFromItemCode('boots1')).toBe('common');
    expect(rarityFromItemCode('pants4')).toBe('epic');
    expect(rarityFromItemCode('jet')).toBe('mythic');
    expect(rarityFromItemCode('knife')).toBe('common');
    expect(rarityFromItemCode('tank')).toBe('legendary');
  });

  it('returns null for skins, resources and junk', () => {
    expect(rarityFromItemCode('winterJet')).toBeNull();
    expect(rarityFromItemCode('scraps')).toBeNull();
    expect(rarityFromItemCode('')).toBeNull();
    expect(rarityFromItemCode(null)).toBeNull();
  });
});

describe('parsePrice', () => {
  it('reads plain and grouped decimals', () => {
    expect(parsePrice('392.991')).toBeCloseTo(392.991, 9);
    expect(parsePrice('1.43')).toBeCloseTo(1.43, 9);
    expect(parsePrice(' 1,234.5 ')).toBeCloseTo(1234.5, 9);
    expect(parsePrice('385')).toBe(385);
  });

  it('expands the K and M suffixes the header uses', () => {
    expect(parsePrice('1.858K')).toBeCloseTo(1858, 9);
    expect(parsePrice('2M')).toBe(2_000_000);
  });

  it('rejects anything that is not a bare number', () => {
    expect(parsePrice('BUY')).toBeNull();
    expect(parsePrice('3h38m')).toBeNull();
    expect(parsePrice('100%')).toBeNull();
    expect(parsePrice('')).toBeNull();
  });
});

describe('isItemImageAlt', () => {
  it('keeps skins and drops avatars and flags', () => {
    expect(isItemImageAlt('winterJet')).toBe(true);
    expect(isItemImageAlt('dieselGloves')).toBe(true);
    expect(isItemImageAlt('Nijntje avatar')).toBe(false);
    expect(isItemImageAlt('Netherlands flag')).toBe(false);
    expect(isItemImageAlt('')).toBe(false);
  });
});

describe('priceFromLines', () => {
  it('takes the number just before BUY, not the stats or durability', () => {
    expect(priceFromLines(['239', '44%', '100%', 'khaleesi', '26m', '383.8', 'BUY'])).toBe('383.8');
    expect(priceFromLines(['4%', '100%', 'Nijntje', '3h38m', '1.43', 'BUY'])).toBe('1.43');
  });

  it('returns null when there is no BUY or no number before it', () => {
    expect(priceFromLines(['Nijntje', '3h38m'])).toBeNull();
    expect(priceFromLines(['Nijntje', 'BUY'])).toBeNull();
  });
});

describe('verdict', () => {
  it('measures the displayed price against the floor as they are, nothing added on either side', () => {
    const v = verdict({ price: 300, floor: 324.7695 });
    expect(v.margin).toBeCloseTo(24.7695, 6);
    expect(v.marginPct).toBeCloseTo(24.7695 / 300, 6);
    expect(v.hit).toBe(true);
  });

  it('is a miss above the floor and null without a floor', () => {
    expect(verdict({ price: 383.8, floor: 324.7695 }).hit).toBe(false);
    expect(verdict({ price: 383.8, floor: null }).hit).toBeNull();
  });

  it('honours a minimum margin percentage', () => {
    expect(verdict({ price: 320, floor: 324.7695, minMarginPct: 5 }).hit).toBe(false);
    expect(verdict({ price: 300, floor: 324.7695, minMarginPct: 5 }).hit).toBe(true);
  });

  it('reports how far above the floor the price sits and how much of it scrap covers', () => {
    const v = verdict({ price: 383.8, floor: 324.7695 });
    expect(v.ratio).toBeCloseTo(383.8 / 324.7695, 6);
    expect(v.coverPct).toBeCloseTo((324.7695 / 383.8) * 100, 6);
    expect(verdict({ price: 383.8, floor: null }).ratio).toBeNull();
  });
});

describe('closestIndex', () => {
  it('picks the offer nearest its floor, ignoring unreadable ones', () => {
    const rows = [{ ratio: 1.21 }, { ratio: null }, { ratio: 1.08 }, { ratio: 1.18 }];
    expect(closestIndex(rows)).toBe(2);
  });

  it('is -1 when nothing is readable', () => {
    expect(closestIndex([{ ratio: null }, {}])).toBe(-1);
    expect(closestIndex([])).toBe(-1);
  });
});

describe('fmtQty', () => {
  it('shortens big quantities the way the game does', () => {
    expect(fmtQty(650675)).toBe('651k');
    expect(fmtQty(1858)).toBe('1.9k');
    expect(fmtQty(270)).toBe('270');
    expect(fmtQty(null)).toBe('–');
  });
});
