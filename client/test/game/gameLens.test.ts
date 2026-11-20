import { describe, expect, it } from "vitest";
import { GAME_FOV, LENS_FAR, LENS_NEAR, lensProjection } from "@csarkosh/engine/game/gameLens";
import { RING_CELLS, RING_COUNT, ringSpacing } from "@csarkosh/engine/game/clipmap";

describe("the game's lens", () => {
  it("is a vertical field of view of 1.4 rad between planes at 5 cm and 10 km", () => {
    expect(lensProjection()).toEqual({ fov: 1.4, near: 0.05, far: 10000 });
    expect([GAME_FOV, LENS_NEAR, LENS_FAR]).toEqual([1.4, 0.05, 10000]);
  });

  it("takes a film shot's or the free camera's field of view, through the same planes", () => {
    expect(lensProjection(0.6)).toEqual({ fov: 0.6, near: LENS_NEAR, far: LENS_FAR });
  });

  it("makes a record of its own each time", () => {
    expect(lensProjection()).not.toBe(lensProjection());
  });

  it("reaches past the outermost ring's corner", () => {
    // The outermost ring, 1 m at its finest: half its side along each axis, to its corner.
    const half = (RING_CELLS / 2) * ringSpacing(RING_COUNT - 1);
    expect(LENS_FAR).toBeGreaterThan(Math.hypot(half, half));
  });
});
