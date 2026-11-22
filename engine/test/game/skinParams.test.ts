import { describe, it, expect } from "vitest";
import { SKIN_WRAP, skinWrapLambert } from "../../src/game/skinParams.js";

describe("skinWrapLambert: the wrap term of the skin's shading", () => {
  it("is energy-conserving: never above Lambert at full light, lifts the terminator, zero well behind it", () => {
    expect(skinWrapLambert(1, SKIN_WRAP)).toBeLessThanOrEqual(1);
    expect(skinWrapLambert(0, SKIN_WRAP)).toBeGreaterThan(0);
    expect(skinWrapLambert(-1, SKIN_WRAP)).toBe(0);
    expect(skinWrapLambert(0.5, 0)).toBeCloseTo(0.5, 6);
  });
});
