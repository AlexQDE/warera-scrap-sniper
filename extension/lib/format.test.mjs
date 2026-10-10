import { describe, it, expect } from "vitest";
import { gold, signedGold } from "./format.mjs";

describe("gold amounts", () => {
  it("prints whole gold from 100 up, one decimal from 10, two below", () => {
    expect(gold(5302.03)).toBe("5,302");
    expect(gold(482.6)).toBe("483");
    expect(gold(38.04)).toBe("38.0");
    expect(gold(3.862)).toBe("3.86");
    expect(gold(0)).toBe("0.00");
    expect(gold(null)).toBe("–");
    expect(gold(NaN)).toBe("–");
  });
  it("signs a result with a real minus sign", () => {
    expect(signedGold(-5302.03)).toBe("−5,302");
    expect(signedGold(138.2)).toBe("+138");
    expect(signedGold(-2.444)).toBe("−2.44");
    expect(signedGold(null)).toBe("–");
  });
});
