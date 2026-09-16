import { activeTerrainVariant } from "../sim/terrain.js";
import type { FreecamView } from "./renderer.js";

/**
 * The title screen's camera path, pure and Babylon-free: a slow pan along the
 * Pacific shore, from a little way out over the water, high and tilted up so
 * that the beach is a strip across the bottom of the frame and the forest
 * fills the rest.
 *
 * The stretch is curated for the title seed (`day-hike`): between these two
 * z values the forest comes down to the beach, and from this line the sea
 * stays out of frame, even on a 21:9 screen. `landingPath.test.ts` holds
 * both. Outside it the coast turns to bare headland, so the pan eases to a
 * stop at each end and comes back rather than running on.
 */
export const PAN_Z_SOUTH = -1450;
export const PAN_Z_NORTH = 650;

/** Along-shore speed at the middle of the stretch, metres per second. At
 * this pace one leg takes about 23 minutes, so the ease at the ends is
 * rarely seen. */
export const PAN_METRES_PER_SECOND = 1.5;

/** Signed metres from the coastline; negative is out to sea. Out here the
 * treeline is about 140 m away, far enough to see the canopy rise inland
 * behind it. */
export const SHORE_OFFSET = -30;

/** Eye height above sea level. Distance, height and PITCH are tuned
 * together: the bottom of the frame meets the ground ~100 m ahead, well up
 * the beach, and the treeline's foot sits just above it, so the sand is about
 * a tenth of the frame. Clear of the tallest sea stack (38 m). */
export const EYE_ABOVE_SEA = 45;

/** Freecam pitch, positive down: tilted UP, which lifts the bottom of the
 * frame off the water and keeps the treeline in view from this height. */
export const PITCH = -0.27;

/** Half-width of the window the coastline is averaged over. The raw line
 * bends at up to 0.4 m across per metre along; averaging stops the camera
 * swerving and the heading twitching at every small cove. */
const SMOOTH_HALF = 80;

/** The coastline's x at `z`, averaged over ±SMOOTH_HALF. `coastDistance` is
 * signed x − coastlineX, so the coastline is 0 − d at any z. */
function smoothCoastlineX(seed: number, z: number): number {
  const coast = activeTerrainVariant().coastDistance;
  if (coast === undefined) return 0;
  const n = 4;
  let sum = 0;
  for (let i = -n; i <= n; i++) sum -= coast(seed, 0, z + (i * SMOOTH_HALF) / n);
  return sum / (2 * n + 1);
}

/**
 * The camera `seconds` into the pan. It starts in the middle of the stretch,
 * already moving north, so the first frame is never a held shot.
 */
export function landingView(seed: number, seconds: number): FreecamView {
  const mid = (PAN_Z_SOUTH + PAN_Z_NORTH) / 2;
  const half = (PAN_Z_NORTH - PAN_Z_SOUTH) / 2;
  const z = mid + half * Math.sin((seconds * PAN_METRES_PER_SECOND) / half);

  const x = smoothCoastlineX(seed, z) + SHORE_OFFSET;
  // Face along the shore's inland normal. The coastline is x = c(z), so its
  // normal is (1, −c′); yaw 0 faces +Z and forward is (sin yaw, cos yaw).
  const slope = (smoothCoastlineX(seed, z + SMOOTH_HALF) - smoothCoastlineX(seed, z - SMOOTH_HALF)) / (2 * SMOOTH_HALF);
  const yaw = Math.atan2(1, -slope);

  return { x, y: EYE_ABOVE_SEA, z, yaw, pitch: PITCH };
}
