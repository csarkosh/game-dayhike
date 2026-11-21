/**
 * The canopy over the lens: the forest's density at the camera, 0 to 1, a
 * full terrain sample, so it is taken again only once the camera has moved
 * a metre from where it was taken. What the drips are heard by
 * (`ambientAudio.ts`) and the surf is muffled by; one read for all of them.
 * Loads no engine.
 */
import { forestDensity } from "../sim/vegetation.js";

/** How far the camera moves, metres on the ground plane, before the canopy is read again. */
export const LENS_CANOPY_STEP = 1;

export type LensCanopy = {
  /** The canopy over (x, z): read there, or the last read where that was within a step of here. */
  over(x: number, z: number): number;
  /** The last read; 0 before the first. */
  readonly value: number;
};

/** The canopy of `seed`'s forest, not yet read. */
export function createLensCanopy(seed: number): LensCanopy {
  let atX = Number.NaN;
  let atZ = Number.NaN;
  let value = 0;
  return {
    over(x, z) {
      // Written so a first read, from no place at all, is taken.
      if (!(Math.hypot(x - atX, z - atZ) <= LENS_CANOPY_STEP)) {
        atX = x;
        atZ = z;
        value = forestDensity(seed, x, z);
      }
      return value;
    },
    get value() {
      return value;
    },
  };
}
