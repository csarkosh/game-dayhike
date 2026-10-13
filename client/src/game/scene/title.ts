/**
 * The title loop's scene: five slow shots of a world in overcast haze, end to end, recorded and
 * joined by dissolves into the title page's 30 s loop (`docs/gameplay/2026-10-01-title-loop.md`
 * §2). A pure function of the world's places; no people, no car, no captions.
 */
import { WEATHER_PRESETS } from "../weather.js";
import { cutList, drift, holdLookingAt, type Cut, type Look } from "./shots.js";
import type { Scene } from "./timeline.js";

export const TITLE_DURATION = 35;
export const TITLE_SHOTS: readonly { from: number; to: number }[] = [
  { from: 0, to: 7 }, { from: 7, to: 14 }, { from: 14, to: 21 }, { from: 21, to: 28 }, { from: 28, to: 35 },
];
/** One afternoon hour, held: the light never changes across the loop. */
export const TITLE_HOUR = 15;
export const TITLE_WEATHER = WEATHER_PRESETS.overcast;
/** The title's world: one with every feature the tour shows, a cove between its headlands, a lake
 * with its marsh on the trail's way up, and a bare rock summit. The intro's own world has no lake. */
export const TITLE_SEED_TOKEN = "ash";

export type TitleWorld = {
  ground(x: number, z: number): number;
  seaLevel: number;
  /** The shoreline's x at z; the sea lies to -x. */
  coastlineX(z: number): number;
  cove: { z0: number; halfWidth: number };
  /** The lake: its centre, the water's level, and its rim's distance from the centre by azimuth
   * (radians, 0 facing +z, a quarter turn +x), the farthest shore the ray crosses. */
  water: { x: number; z: number; level: number; rim: (a: number) => number } | null;
  meadow: { x: number; z: number; radius: number } | null;
  peak: { x: number; z: number; radius: number };
  start: { x: number; z: number; yaw: number };
};

/** Every moving shot's move: 12 m in its 7 s, 1.7 m/s. */
const DRIFT_M = 12;
const SHOT_S = 7;
/** The coast: inside the cove, this far out over the water from the shoreline and this high, starting
 * this share of its half-width short of its middle and drifting along it, looking along the beach to
 * a point this share of its half-width beyond its middle and this far inland: the sea on one side,
 * the beach and the forest's edge on the other, a headland ahead in the haze. */
const COAST_OUT_M = 70;
const COAST_UP_M = 6;
const COAST_FROM = -0.6;
const COVE_LOOK = 0.7;
const COVE_IN_M = 10;
/** The forest floor: this far along the trail's first heading from its start and this far to its
 * right, off the trail's bed and among the trees, at this height, drifting along that heading and
 * looking this far ahead at this height: the ferns, the logs and the trunks, the giants above. */
const FLOOR_ALONG_M = 52;
const FLOOR_ASIDE_M = 10;
const FLOOR_UP_M = 1.4;
const FLOOR_LOOK_M = 20;
const FLOOR_LOOK_UP_M = 1.2;
/** The lake: seen across its narrow axis from the higher shore, among the first trees, so the
 * trunks and the floor frame the water and the forest beyond it: the camera this far beyond the
 * rim, this high over the ground, drifting along the shore and looking at the lower shore's water's
 * edge, this far past its rim. */
const SHORE_OUT_M = 18;
const SHORE_UP_M = 6;
const SHORE_LOOK_IN_M = 5;
/** The lake and meadow shots look at a point this high over the water's level or the ground. */
const SHORE_LOOK_UP_M = 1;
/** Directions the rim is read in to find the lake's long axis. */
const RIM_DIRECTIONS = 64;
/** Where there is no lake or meadow: over the trail's start, looking at the peak. */
const HILLS_UP_M = 20;
/** The trailhead: the camera this far behind the start, rising between these heights, looking this
 * far up the trail. Close to the start: the hike's car is parked a few metres behind it. */
const START_BACK_M = 1;
const RISE_FROM_M = 1.6;
const RISE_TO_M = 7.6;
const TRAIL_LOOK_M = 30;
/** The summit: the push starts this far short of the peak's middle and this high over the ground,
 * above the forest that covers its trail's side, at about the summit's own height. */
const SUMMIT_SHORT_M = 100;
const SUMMIT_UP_M = 45;
/** The summit's push looks this high over the peak's ground, at its crest against the sky. */
const PEAK_LOOK_UP_M = 8;

export function titleScene(w: TitleWorld): Scene {
  const onGround = (x: number, z: number, up: number): Look => ({ x, y: w.ground(x, z) + up, z });
  const toPeak = { x: w.peak.x - w.start.x, z: w.peak.z - w.start.z };
  const peakDist = Math.hypot(toPeak.x, toPeak.z);
  const dir = { x: toPeak.x / peakDist, z: toPeak.z / peakDist };
  const peakLook = onGround(w.peak.x, w.peak.z, PEAK_LOOK_UP_M);
  const ahead = (from: Look): Look => ({ x: from.x + dir.x * DRIFT_M, y: from.y, z: from.z + dir.z * DRIFT_M });

  // 1. The coast: low over the cove's water, drifting along the beach and looking along it.
  const coastAt = (z: number): Look => {
    const x = w.coastlineX(z) - COAST_OUT_M;
    return { x, y: Math.max(w.seaLevel, w.ground(x, z)) + COAST_UP_M, z };
  };
  const coastZ = w.cove.z0 + COAST_FROM * w.cove.halfWidth;
  const coastFrom = coastAt(coastZ);
  const coastTo = coastAt(coastZ + DRIFT_M);
  const lookZ = w.cove.z0 + COVE_LOOK * w.cove.halfWidth;
  const coveLook: Look = { x: w.coastlineX(lookZ) + COVE_IN_M, y: w.seaLevel + 3, z: lookZ };

  // 2. The forest floor: beside the trail a little way in, off its bed and among the trees, drifting
  //    along the trail's first heading and looking ahead through the understory.
  const sy = Math.sin(w.start.yaw), cy = Math.cos(w.start.yaw);
  const floorX = w.start.x + sy * FLOOR_ALONG_M + cy * FLOOR_ASIDE_M, floorZ = w.start.z + cy * FLOOR_ALONG_M - sy * FLOOR_ASIDE_M;
  // One height for the drift, over the higher of its two ends.
  const floorY = Math.max(w.ground(floorX, floorZ), w.ground(floorX + sy * DRIFT_M, floorZ + cy * DRIFT_M)) + FLOOR_UP_M;
  const floorFrom: Look = { x: floorX, y: floorY, z: floorZ };
  const floorTo: Look = { x: floorX + sy * DRIFT_M, y: floorY, z: floorZ + cy * DRIFT_M };
  const floorLook = (t: number): Look => onGround(floorX + sy * (DRIFT_M * Math.min(1, t / SHOT_S) + FLOOR_LOOK_M), floorZ + cy * (DRIFT_M * Math.min(1, t / SHOT_S) + FLOOR_LOOK_M), FLOOR_LOOK_UP_M);

  // 3. The lake (a meadow where there is none, the hills where neither): across its narrow axis
  // from the higher shore among its first trees, drifting along it, looking at the lower shore's water.
  const third = (): Cut["shot"] => {
    const lake = w.water;
    if (lake === null) {
      if (w.meadow === null) return holdLookingAt(onGround(w.start.x, w.start.z, HILLS_UP_M), () => peakLook);
      const m = w.meadow;
      const back = Math.atan2(w.start.x - m.x, w.start.z - m.z);
      const out = m.radius + SHORE_OUT_M;
      const eye = onGround(m.x + Math.sin(back) * out, m.z + Math.cos(back) * out, SHORE_UP_M);
      return drift(eye, { x: eye.x + Math.cos(back) * DRIFT_M, y: eye.y, z: eye.z - Math.sin(back) * DRIFT_M }, SHOT_S, onGround(m.x, m.z, SHORE_LOOK_UP_M));
    }
    // The long axis: the direction the rim lies farthest from the centre (toward the peak on a round lake).
    let axis = Math.atan2(toPeak.x, toPeak.z);
    let far = lake.rim(axis) + lake.rim(axis + Math.PI);
    for (let k = 0; k < RIM_DIRECTIONS; k++) {
      const a = (2 * Math.PI * k) / RIM_DIRECTIONS;
      const r = lake.rim(a) + lake.rim(a + Math.PI);
      if (r > far + 1e-9) { far = r; axis = a; }
    }
    // The narrow axis's two shores; the camera on the higher, among its trees, looking at the lower.
    const sideAt = (a: number): Look => {
      const out = lake.rim(a) + SHORE_OUT_M;
      const x = lake.x + Math.sin(a) * out, z = lake.z + Math.cos(a) * out;
      return { x, y: w.ground(x, z), z };
    };
    const s0 = axis + Math.PI / 2, s1 = axis - Math.PI / 2;
    const low = sideAt(s0).y <= sideAt(s1).y ? s0 : s1, high = low === s0 ? s1 : s0;
    const stand = sideAt(high);
    const alongX = Math.sin(axis), alongZ = Math.cos(axis);
    const fromX = stand.x, fromZ = stand.z;
    const toX = stand.x + alongX * DRIFT_M, toZ = stand.z + alongZ * DRIFT_M;
    // One height for the whole drift, clear of the water and of the bank at either end.
    const y = Math.max(lake.level, stand.y, w.ground(toX, toZ)) + SHORE_UP_M;
    const lookOut = lake.rim(low) + SHORE_LOOK_IN_M;
    const lx = lake.x + Math.sin(low) * lookOut, lz = lake.z + Math.cos(low) * lookOut;
    return drift({ x: fromX, y, z: fromZ }, { x: toX, y, z: toZ }, SHOT_S, { x: lx, y: Math.max(lake.level, w.ground(lx, lz)) + SHORE_LOOK_UP_M, z: lz });
  };

  // 4. The trailhead: behind the start, rising, looking up the trail.
  const riseX = w.start.x - sy * START_BACK_M, riseZ = w.start.z - cy * START_BACK_M;
  const trailLook = onGround(w.start.x + sy * TRAIL_LOOK_M, w.start.z + cy * TRAIL_LOOK_M, 3);

  // 5. The summit: from the trail's side, pushing toward the peak.
  const summitFrom = onGround(w.peak.x - dir.x * SUMMIT_SHORT_M, w.peak.z - dir.z * SUMMIT_SHORT_M, SUMMIT_UP_M);

  const s = TITLE_SHOTS;
  const cuts: Cut[] = [
    { ...s[0]!, shot: drift(coastFrom, coastTo, SHOT_S, coveLook) },
    { ...s[1]!, shot: drift(floorFrom, floorTo, SHOT_S, floorLook) },
    { ...s[2]!, shot: third() },
    { ...s[3]!, shot: drift(onGround(riseX, riseZ, RISE_FROM_M), onGround(riseX, riseZ, RISE_TO_M), SHOT_S, trailLook) },
    { ...s[4]!, shot: drift(summitFrom, ahead(summitFrom), SHOT_S, peakLook) },
  ];
  return { duration: TITLE_DURATION, camera: cutList(cuts), actors: [], car: null, captions: [], black: () => 0 };
}
