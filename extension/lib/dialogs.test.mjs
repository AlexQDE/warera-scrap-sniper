// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  caseFromOdds,
  craftTier,
  findDialog,
  createDialogs,
  outcomeLine,
  craftHtml,
  caseHtml,
  chosenMark,
  pieceHtml,
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
// The slot row as read live on 2026-10-10: six gradient tiles with the slot's
// skin image and a "?" for a random craft; the picked tile carries a class
// none of the others has, and the button reads CRAFT instead of CRAFT RANDOM.
function slotDialog(picked) {
  const slots = ["knife", "helmet", "chest", "boots", "gloves", "pants"]
    .map(
      (s) =>
        `<div class="tile ${s === picked ? "picked " : ""}t" style="background-image: linear-gradient(red, black)"><div><img alt="ct${s[0].toUpperCase()}${s.slice(1)}" src="x.png"></div></div>`,
    )
    .join("");
  document.body.innerHTML = `<main></main><div role="dialog"><div>${div(CRAFT_LINES.slice(0, 21))}</div><div class="slots">${slots}</div><button>CLOSE</button><button>${picked ? "CRAFT" : "CRAFT RANDOM"}</button></div>`;
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
      value: {
        value: 3.5,
        label: "4 same · 24 h",
        detail: "4 sales · crit dmg 8–10% · 24 h",
        level: "same",
        hours: 24,
      },
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
  // v0.27 (dev 2026-10-17): a toolbox opens into a tool for an employee; its window has OPEN buttons and odds
  // too, and must never be priced as a case
  const withImage = (alt, lines = CASE_LINES.slice(0, 10)) => {
    document.body.innerHTML = `<main></main><div role="dialog"><img alt="${alt}"><div>${div(lines)}</div><div class="row"><button>OPEN 10</button><button>OPEN</button></div></div>`;
  };
  it("never prices a toolbox as a case, whatever its odds say", () => {
    withImage("toolbox");
    expect(findDialog()).toBeNull();
    withImage("woodenCase");
    expect(findDialog()).toBeNull();
    caseDialog();
    document
      .querySelector('[role="dialog"] > div')
      .insertAdjacentHTML(
        "afterbegin",
        "<div>Open it to get a random tool for one of your employees</div>",
      );
    expect(findDialog()).toBeNull();
  });
  it("takes the case from its image before its odds", () => {
    withImage("case2");
    expect(findDialog()).toMatchObject({ kind: "case", code: "case2" });
    withImage("case1", ["OPEN CASE", "8780 Total cases opened"]);
    expect(findDialog()).toMatchObject({ kind: "case", code: "case1" });
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
    expect(text).toContain("Last knife atk 37 · crit 4% ≈1.43 avg −2.44");
    expect(words(panel)).toBeLessThanOrEqual(40);
    // no piece of this case was worn in battle in what the panel shows: no Eco / War switch
    expect(panel.querySelector('[data-action="ledger-mode"]')).toBeNull();
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
    expect(text).toContain("Today −1.66 g · 1 craft · 1 in battle");
    // sold like it in the last 24 h at the same stats: no mark, the window small
    expect(text).toContain("helmet crit dmg 9% 3.50 24h +0.64");
    // the knife went to battle: no result
    expect(text).toContain("knife atk 30 · crit 3% in battle");
    // 6 scraps × 0.25 + 1 steel × 1.83 = 3.33; EV 0.3 × 1.2 + 0.7 × 1.4 = 1.34
    // the question at CRAFT RANDOM comes first: worth it now?
    expect(
      text.indexOf("Craft now 3.33 → 1.34 · −1.99 g (−60%)"),
    ).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Craft now")).toBeLessThan(text.indexOf("Today"));
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
  it("reads the slot picked for the craft and prices that craft: the doubled steel against the slot's own value", () => {
    slotDialog("boots");
    expect(findDialog()).toMatchObject({
      kind: "craft",
      tier: "common",
      slot: "boots1",
    });
    const d = createDialogs();
    d.render({
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
    const text = document
      .querySelector(`.${PANEL_CLASS}`)
      .textContent.replace(/\s+/g, " ");
    // 6 scraps × 0.25 + 2 steel × 1.83 = 5.16 against common boots' 1.40
    expect(text).toContain("Craft boots 5.16 → 1.40 · −3.76 g (−73%)");
    d.dispose();
    // nothing picked (the "?"): the random craft, as before
    slotDialog(null);
    expect(findDialog()).toMatchObject({ kind: "craft", slot: null });
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
    expect(onAction).toHaveBeenCalledWith("case", null);
    expect(gameClick).toHaveBeenCalledTimes(1);
    d.dispose();
    open.click();
    expect(onAction).toHaveBeenCalledTimes(1);
  });
  it("hands a press of CRAFT over with the window's pick: chosen by the button's label, the slot by its marked tile", () => {
    const press = (picked) => {
      slotDialog(picked);
      const onAction = vi.fn();
      const d = createDialogs({ onAction });
      [...document.querySelectorAll("button")]
        .find((b) => /^craft/i.test(b.textContent))
        .click();
      d.dispose();
      return onAction.mock.calls[0];
    };
    expect(press("boots")).toEqual([
      "craft",
      { tier: "common", chosen: true, slot: "boots1" },
    ]);
    expect(press("knife")).toEqual([
      "craft",
      { tier: "common", chosen: true, slot: "knife" },
    ]);
    expect(press(null)).toEqual([
      "craft",
      { tier: "common", chosen: false, slot: null },
    ]);
    // the button says CRAFT but no tile reads as marked: still a chosen slot, which one unknown
    slotDialog(null);
    const button = [...document.querySelectorAll("button")].find((b) =>
      /^craft/i.test(b.textContent),
    );
    button.textContent = "CRAFT";
    const onAction = vi.fn();
    const d = createDialogs({ onAction });
    button.click();
    d.dispose();
    expect(onAction).toHaveBeenCalledWith("craft", {
      tier: "common",
      chosen: true,
      slot: null,
    });
  });
  it("marks a craft charged the chosen slot's doubled steel, faint when a streak tells it", () => {
    const sniper = {
      code: "sniper",
      source: "crafted",
      skills: { attack: 120, criticalChance: 18 },
      fate: "held",
      cost: 60,
      value: { value: 70, level: "same", hours: 24 },
    };
    expect(chosenMark({ ...sniper, chosen: false })).toBe("");
    expect(chosenMark({ ...sniper, source: "bought", chosen: true })).toBe("");
    const title = (html) => {
      const box = document.createElement("div");
      box.innerHTML = html;
      return box.querySelector(".lens-pick")?.title ?? "";
    };
    const seen = chosenMark({ ...sniper, chosen: true, chosenBy: "seen" });
    expect(seen).toContain("◎");
    expect(title(seen)).toBe(
      "Sniper craft (slot chosen), twice the steel: picked in the game's craft window",
    );
    expect(seen).not.toContain("data-guess");
    const streak = chosenMark({
      ...sniper,
      chosen: true,
      chosenBy: "streak",
      streak: 12,
    });
    expect(title(streak)).toContain("12 snipers in a row");
    expect(streak).toContain("data-guess");
    expect(pieceHtml({ ...sniper, chosen: true, chosenBy: "seen" })).toContain(
      "◎",
    );
  });
  it("says the player's own results need the API key instead of waiting for a history that cannot come", () => {
    const craft = craftHtml({ tier: "epic", ledger: null, needsKey: true });
    expect(craft).toContain("needs your API key");
    expect(craft).not.toContain("Reading your history");
    const open = caseHtml({ code: "case1", ledger: null, needsKey: true });
    expect(open).toContain("needs your API key");
    expect(open).not.toContain("Reading your history");
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
