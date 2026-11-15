import { describe, expect, it } from "vitest";
import { WING_TIME_WRAP, wingAngle, wingHalfSpan, wingTime } from "../../src/game/wingParams.js";

describe("a wing's beat as numbers", () => {
  it("counts its clock in seconds and wraps it", () => {
    expect(wingTime(1500)).toBe(1.5);
    expect(wingTime((WING_TIME_WRAP + 2) * 1000)).toBeCloseTo(2, 9);
  });

  it("beats a model of no width against one metre", () => {
    expect(wingHalfSpan(0.4)).toBe(0.4);
    expect(wingHalfSpan(0)).toBe(1);
    expect(wingHalfSpan(-3)).toBe(1);
  });

  it("is amp·sin(ωt + phase), the same across the wrap for a whole number of beats in it", () => {
    const omega = (2 * Math.PI * 900) / WING_TIME_WRAP;
    expect(wingAngle(0.1, 0.3, 0.8, omega)).toBeCloseTo(0.8 * Math.sin(0.1 * omega + 0.3), 12);
    expect(wingAngle(WING_TIME_WRAP + 0.1, 0.3, 0.8, omega)).toBeCloseTo(wingAngle(0.1, 0.3, 0.8, omega), 6);
    expect(wingAngle(5, 1, 0, omega)).toBe(0);
  });
});
