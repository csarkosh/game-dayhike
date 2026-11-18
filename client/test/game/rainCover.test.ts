import { describe, expect, it } from "vitest";
import { RAIN_MAP_CAMERA, RAIN_MAP_CLEAR, createRainMapPlace, rainMapTexel } from "../../src/game/rainCover.js";
import { RAIN_MAP } from "../../src/game/rainParams.js";
import { babylonText } from "../helpers/babylonFixture.js";

/** The height shader's fragment stage on Babylon.js, recorded. */
const RAIN_HEIGHT_FRAGMENT = babylonText("stages/rainHeight.fragment.glsl");

describe("the cover map with no engine", () => {
  it("clears to a height far below the world, open to the rain, so an unwritten texel never covers", () => {
    expect(RAIN_MAP_CLEAR).toEqual({ height: -1000, transmission: 1, lift: 0 });
  });

  it("writes a texel as the height shader does: ground by its canopy, water open, the rest hard", () => {
    // The shader's own lines, which this mirrors.
    expect(RAIN_HEIGHT_FRAGMENT).toContain("float transmission = 1.0 - 0.65 * vCanopy;");
    expect(RAIN_HEIGHT_FRAGMENT).toContain("float lift = 10.0 * step(0.01, vCanopy);");
    expect(rainMapTexel("terrain", 12, 0)).toEqual({ height: 12, transmission: 1, lift: 0 });
    expect(rainMapTexel("terrain", 12, 1)).toEqual({ height: 12, transmission: 1 - RAIN_MAP.canopyBlock, lift: RAIN_MAP.canopyLift });
    const thin = rainMapTexel("terrain", 12, 0.4);
    expect(thin.transmission).toBeCloseTo(0.74, 9);
    expect(thin.lift).toBe(10);
    // The lift's step: none under a hundredth of canopy, all of it from there.
    expect(rainMapTexel("terrain", 0, 0.009).lift).toBe(0);
    expect(rainMapTexel("terrain", 0, 0.01).lift).toBe(10);
    expect(rainMapTexel("water", 3)).toEqual({ height: 3, transmission: 1, lift: 0 });
    expect(rainMapTexel("hard", 3)).toEqual({ height: 3, transmission: 0, lift: 0 });
    expect(rainMapTexel("hard", 3, 1)).toEqual({ height: 3, transmission: 0, lift: 0 });
  });

  it("looks down on the map's extent from its height, as far below the centre as above it", () => {
    expect(RAIN_MAP_CAMERA).toEqual({ half: RAIN_MAP.extent / 2, near: 1, far: 2 * RAIN_MAP.height, height: RAIN_MAP.height });
  });

  it("stands nowhere until placed, then moves by the step rule alone", () => {
    const place = createRainMapPlace();
    expect(Number.isNaN(place.centre.x)).toBe(true);
    expect(place.update({ x: 10, y: 5, z: -20 })).toBe(true);
    expect(place.centre).toEqual({ x: 10, y: 5, z: -20 });
    // Within the step: it stands, y and all.
    expect(place.update({ x: 10 + RAIN_MAP.step, y: 9, z: -20 })).toBe(false);
    expect(place.centre).toEqual({ x: 10, y: 5, z: -20 });
    // Past it: at the player.
    expect(place.update({ x: 10 + RAIN_MAP.step + 0.5, y: 9, z: -20 })).toBe(true);
    expect(place.centre).toEqual({ x: 10 + RAIN_MAP.step + 0.5, y: 9, z: -20 });
  });

  it("is drawn again where it stands on the update after a redraw, once", () => {
    const place = createRainMapPlace();
    place.update({ x: 0, y: 0, z: 0 });
    expect(place.update({ x: 1, y: 0, z: 0 })).toBe(false);
    place.redraw();
    expect(place.update({ x: 1, y: 0, z: 0 })).toBe(true);
    expect(place.centre).toEqual({ x: 0, y: 0, z: 0 });
    expect(place.update({ x: 1, y: 0, z: 0 })).toBe(false);
  });
});
