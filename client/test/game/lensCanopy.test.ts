import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { forestDensity } from "../../src/sim/vegetation.js";
import { LENS_CANOPY_STEP, createLensCanopy } from "../../src/game/lensCanopy.js";

const SEED = 20260914;

describe("the canopy over the lens", () => {
  it("is the forest's density at the camera, 0 before the first read", () => {
    const canopy = createLensCanopy(SEED);
    expect(canopy.value).toBe(0);
    expect(canopy.over(250, -500)).toBe(forestDensity(SEED, 250, -500));
    expect(canopy.value).toBe(forestDensity(SEED, 250, -500));
  });

  it("is read again only once the camera has moved a step from where it was read", () => {
    const canopy = createLensCanopy(SEED);
    // A place and one under a step away whose densities differ: the first's stands.
    let x = 250;
    let far = 0;
    for (; x < 2250; x += 37) {
      far = forestDensity(SEED, x + 60, -500);
      if (far !== forestDensity(SEED, x, -500)) break;
    }
    const here = canopy.over(x, -500);
    expect(far).not.toBe(here);
    expect(canopy.over(x + LENS_CANOPY_STEP, -500)).toBe(here);
    expect(canopy.over(x + 60, -500)).toBe(far);
    // And from there, not from the first place.
    expect(canopy.over(x + 60 - LENS_CANOPY_STEP, -500)).toBe(far);
  });
});
