import { describe, it, expect } from "vitest";
import { radiusOf } from "../../src/admin/worldMap.js";

describe("radiusOf", () => {
  it("runs from 3 px for none to 14 px for the busiest city, by the square root", () => {
    expect(radiusOf(0, 9)).toBe(3);
    expect(radiusOf(9, 9)).toBe(14);
    expect(radiusOf(4, 16)).toBeCloseTo(3 + 11 * 0.5, 9);
    expect(radiusOf(5, 0)).toBe(14);
  });
});
