// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  caseFromOdds,
  craftTier,
  findDialog,
  createDialogs,
  outcomeLine,
  PANEL_CLASS,
} from "./dialogs.mjs";

// The two dialogs as the live page printed them on 2026-10-08.
const CASE_LINES = [
  "OPEN CASE",
  "Weapon 30%,",
  "Equipment 70%",
  "0.01% Mythic",
  "0.04% Legendary",
  "0.85% Epic",
  "7.1% Rare",
  "30% Uncommon",
  "62% Common",
  "8780 Total cases opened",
  "OPEN 10",
  "OPEN CASE",
];
const CRAFT_LINES = [
  "CRAFT ITEMS",
  "Mythic",
  "1.46K",
  "32",
  "Legendary",
  "486",
  "16",
  "Epic",
  "162",
  "8",
  "Rare",
  "54",
  "4",
  "Uncommon",
  "18",
  "2",
  "Common",
  "6",
  "1",
  "Common",
  "?",
  "CLOSE",
  "CRAFT RANDOM",
];
const div = (lines) => lines.map((l) => `<div>${l}</div>`).join("");
function caseDialog() {
  document.body.innerHTML = `<main></main><div role="dialog"><div>${div(CASE_LINES.slice(0, 10))}</div><div class="row"><button>OPEN 10</button><button>OPEN CASE</button></div></div>`;
}
function craftDialog() {
  document.body.innerHTML = `<main></main><div role="dialog"><div>${div(CRAFT_LINES.slice(0, 21))}</div><button>CLOSE</button><button>CRAFT RANDOM</button></div>`;
}
// jsdom has no layout: innerText is textContent, so give each element its lines
for (const proto of [window.HTMLElement.prototype]) {
  Object.defineProperty(proto, "innerText", {
    configurable: true,
    get() {
      return [...this.querySelectorAll("div, button, p, span, small, b")].length
        ? [...this.childNodes]
            .map((n) =>
              n.nodeType === 3 ? n.textContent : (n.innerText ?? ""),
            )
            .join("\n")
        : this.textContent;
    },
  });
}
afterEach(() => {
  document.body.innerHTML = "";
});

const o = (over) => ({
  n: 0,
  cost: 0,
  proceeds: 0,
  heldValue: 0,
  held: 0,
  heldPriced: 0,
  estimated: 0,
  estimatedKnown: 0,
  ...over,
});
const ledger = {
  windows: {
    today: {
      cases: {
        case1: o({
          n: 10,
          cost: 38,
          proceeds: 12,
          held: 1,
          heldPriced: 1,
          heldValue: 1.5,
          estimated: -24.5,
          estimatedKnown: 10,
        }),
      },
      tiers: {
        common: o({
          n: 1,
          cost: 2.86,
          proceeds: 1.2,
          estimated: -1.66,
          estimatedKnown: 1,
          worn: 1,
        }),
      },
    },
    all: {
      cases: {
        case1: o({
          n: 8780,
          cost: 31375.79,
          proceeds: 24126.85,
          estimated: -5302.03,
          estimatedKnown: 8780,
        }),
      },
      tiers: {},
    },
  },
  lastOpened: {
    code: "knife",
    via: "case1",
    skills: { attack: 37, criticalChance: 4 },
    fate: "held",
    cost: 3.87,
    approx: false,
    value: { value: 1.43, label: "game avg, any stats" },
  },
  lastCrafted: {
    code: "helmet1",
    rarity: "common",
    skills: { criticalDamages: 9 },
    fate: "scrapped",
    cost: 2.86,
    proceeds: 1.2,
    approx: false,
  },
  mode: "eco",
  craftsToday: [
    {
      code: "helmet1",
      rarity: "common",
      skills: { criticalDamages: 9 },
      fate: "held",
      cost: 2.86,
      approx: false,
      worn: false,
      value: { value: 3.5, label: "4 sales · crit dmg 8–10% · 7 d" },
    },
    {
      code: "knife",
      rarity: "common",
      skills: { attack: 30, criticalChance: 3 },
      fate: "scrapped",
      cost: 2.9,
      proceeds: 0.4,
      approx: false,
      worn: true,
    },
    {
      code: "tank",
      rarity: "legendary",
      skills: { attack: 150, criticalChance: 30 },
      fate: "held",
      cost: 120,
      worn: false,
      value: { value: 141, label: "3 sales" },
    },
  ],
};
/** Words a player reads in a panel. */
const words = (el) =>
  el.textContent
    .replace(/[·→~+−\-%]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
const book = (bid, ask) => ({
  bid,
  ask,
  bids: [{ price: bid, quantity: 1e6 }],
  asks: [{ price: ask, quantity: 1e6 }],
});
const cases = {
  at: new Date().toISOString(),
  books: {
    scraps: book(0.24, 0.25),
    steel: book(1.8, 1.83),
    case1: book(3.86, 3.9),
    case2: book(24.4, 25),
  },
};

describe("reading the game's dialogs", () => {
  it("tells the case from the odds it prints", () => {
    expect(caseFromOdds(CASE_LINES)).toBe("case1");
    expect(
      caseFromOdds([
        "0.37% Mythic",
        "2.5% Legendary",
        "14% Epic",
        "32% Rare",
        "50% Uncommon",
      ]),
    ).toBe("case2");
    expect(caseFromOdds(["OPEN"])).toBeNull();
  });
  it("reads the craft dialog's selected tier: the heading after the six tiles", () => {
    expect(craftTier(CRAFT_LINES)).toBe("common");
    expect(craftTier(CRAFT_LINES.slice(0, 19))).toBeNull();
  });
  it("finds the open dialog and what it is for", () => {
    caseDialog();
    expect(findDialog()).toMatchObject({ kind: "case", code: "case1" });
    craftDialog();
    expect(findDialog()).toMatchObject({ kind: "craft", tier: "common" });
    document.body.innerHTML =
      '<div role="dialog"><div>Something else</div><button>OK</button></div>';
    expect(findDialog()).toBeNull();
  });
});

describe("annotating them", () => {
  it("puts the case's worth, the player's openings and the last opening above the open buttons, in few words", () => {
    caseDialog();
    const d = createDialogs();
    const r = d.render({
      cases,
      avg: null,
      settings: { sellFrom: "never" },
      ledger,
    });
    expect(r.kind).toBe("case");
    const panel = document.querySelector(`.${PANEL_CLASS}`);
    expect(panel.nextElementSibling.className).toBe("row"); // before the box that holds both open buttons
    const text = panel.textContent.replace(/\s+/g, " ");
    expect(text).toContain("Sell 3.86");
    expect(text).toContain("Today −24.5 g · 10 opened");
    expect(text).toContain("All −5,302 g · 8,780 opened");
    // valued at the game's average, not at sales of its stats: marked rough
    expect(text).toContain("Last knife atk 37 · crit 4% ≈1.43 −2.44");
    expect(words(panel)).toBeLessThanOrEqual(40);
    expect(panel.querySelector('[data-action="ledger-mode"]')).not.toBeNull();
    // a second render reuses the panel; the dialog closing removes it
    d.render({ cases, avg: null, settings: {}, ledger });
    expect(document.querySelectorAll(`.${PANEL_CLASS}`)).toHaveLength(1);
    document.body.innerHTML = "<main></main>";
    expect(d.render({ cases, settings: {}, ledger })).toBeNull();
    d.dispose();
  });
  it("lists today's crafts of the tier with what each sells for and its profit; worn gear says so and counts nothing", () => {
    craftDialog();
    const d = createDialogs();
    const r = d.render({
      cases,
      avg: {
        values: {
          knife: 1.2,
          helmet1: 1.4,
          chest1: 1.4,
          gloves1: 1.4,
          pants1: 1.4,
          boots1: 1.4,
        },
      },
      settings: {},
      ledger,
    });
    expect(r).toMatchObject({ kind: "craft", tier: "common" });
    const panel = document.querySelector(`.${PANEL_CLASS}`);
    expect(panel.nextElementSibling.textContent).toBe("CRAFT RANDOM");
    const text = panel.textContent.replace(/\s+/g, " ");
    expect(text).toContain("Common craft");
    expect(text).toContain("Today −1.66 g · 1 craft · 1 in battle");
    // a held helmet: sells ~3.50 against its cost 2.86
    expect(text).toContain("helmet crit dmg 9% ~3.50 +0.64");
    // the knife went to battle: no result
    expect(text).toContain("knife atk 30 · crit 3% in battle");
    // 6 scraps × 0.25 + 1 steel × 1.83 = 3.33; EV 0.3 × 1.2 + 0.7 × 1.4 = 1.34
    expect(text).toContain("Craft now 3.33 → ~1.34 g −60%");
    expect(words(panel)).toBeLessThanOrEqual(45);
    const eco = panel.querySelector(
      '[data-action="ledger-mode"][data-mode="eco"]',
    );
    expect(eco.getAttribute("aria-pressed")).toBe("true");
    d.dispose();
  });
  it("puts the panel above the craft dialog's button row, not squeezed between its buttons", () => {
    document.body.innerHTML = `<main></main><div role="dialog"><div>${div(CRAFT_LINES.slice(0, 21))}</div><div class="actions"><button>CLOSE</button><button>CRAFT RANDOM</button></div></div>`;
    const d = createDialogs();
    d.render({ cases, avg: null, settings: {}, ledger });
    const panel = document.querySelector(`.${PANEL_CLASS}`);
    expect(panel.nextElementSibling.className).toBe("actions");
    d.dispose();
  });
  it("hands a click on the Eco / War switch to the app and keeps it from the game's dialog", () => {
    craftDialog();
    const onMode = vi.fn();
    const d = createDialogs({ onMode });
    d.render({ cases, avg: null, settings: {}, ledger });
    const gameClick = vi.fn();
    document
      .querySelector('[role="dialog"]')
      .addEventListener("click", gameClick);
    document
      .querySelector('[data-action="ledger-mode"][data-mode="war"]')
      .click();
    expect(onMode).toHaveBeenCalledWith("war");
    expect(gameClick).not.toHaveBeenCalled();
    d.dispose();
  });
  it("observes a click on the game's own button and asks for a read, without stopping the click", () => {
    caseDialog();
    const onAction = vi.fn();
    const d = createDialogs({ onAction });
    const gameClick = vi.fn();
    const open = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "OPEN CASE",
    );
    open.addEventListener("click", gameClick);
    open.click();
    expect(onAction).toHaveBeenCalledWith("case");
    expect(gameClick).toHaveBeenCalledTimes(1);
    d.dispose();
    open.click();
    expect(onAction).toHaveBeenCalledTimes(1);
  });
  it("words an outcome as its result and count, an empty one plainly", () => {
    expect(outcomeLine(null, "opened")).toBe("none");
    expect(
      outcomeLine(
        o({ n: 2, cost: 2, proceeds: 3, estimated: 1, estimatedKnown: 2 }),
        "opened",
      ).replace(/<[^>]+>/g, ""),
    ).toBe("+1.00 g · 2 opened");
  });
});
