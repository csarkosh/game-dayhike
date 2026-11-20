import { describe, expect, it } from "vitest";
import { GROUND_CONFORM_OVERSHOOT, GROUND_CONFORM_RAMP, conformDisplacement, conformUniforms } from "@csarkosh/engine/game/groundConform";

describe("the base conform's uniforms", () => {
  it("are its two constants, by name", () => {
    expect(conformUniforms()).toEqual({ gcRamp: [GROUND_CONFORM_RAMP], gcOvershoot: [GROUND_CONFORM_OVERSHOOT] });
  });

  it("are the numbers the displacement is computed with", () => {
    const u = conformUniforms();
    // At the base, the downhill edge goes past the plane by the overshoot; above the ramp, nowhere.
    expect(conformDisplacement(1, 0, 0, -0.5, 0)).toBeCloseTo(-0.5 * u.gcOvershoot[0], 12);
    expect(conformDisplacement(1, 0, u.gcRamp[0], -0.5, 0)).toBe(0);
  });
});
