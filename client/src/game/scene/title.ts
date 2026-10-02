/**
 * The title loop's scene: five slow shots of the film's world in overcast haze, end to end, recorded
 * and joined by dissolves into the title page's 30 s loop (`docs/gameplay/2026-10-01-title-loop.md`
 * §2). A pure function of the world's places; no people, no car, no captions.
 */
import { WEATHER_PRESETS } from "../weather.js";
import { INTRO_SEED_TOKEN } from "./intro.js";
import { cutList, drift, holdLookingAt, type Cut, type Look } from "./shots.js";
import type { Scene } from "./timeline.js";

export const TITLE_DURATION = 35;
export const TITLE_SHOTS: readonly { from: number; to: number }[] = [
  { from: 0, to: 7 }, { from: 7, to: 14 }, { from: 14, to: 21 }, { from: 21, to: 28 }, { from: 28, to: 35 },
];
/** One afternoon hour, held: the light never changes across the loop. */
export const TITLE_HOUR = 15;
export const TITLE_WEATHER = WEATHER_PRESETS.overcast;
/** The film's world: the place in the title, the film and the hike is one place. */
export const TITLE_SEED_TOKEN = INTRO_SEED_TOKEN;

export type TitleWorld = {
  ground(x: number, z: number): number;
  seaLevel: number;
  /** The shoreline's x at z; the sea lies to -x. */
  coastlineX(z: number): number;
  cove: { z0: number; halfWidth: number };
  water: { x: number; z: number; radius: number; level: number } | null;
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
/** The forest: from this share of the way from the trail's start to the peak, this high over the ground. */
const CANOPY_ALONG = 0.25;
const CANOPY_UP_M = 90;
/** The lake: the camera this far beyond its rim on the trail's side, this high over the water or
 * the bank, panning this far across it. */
const SHORE_OUT_M = 55;
const SHORE_UP_M = 25;
const PAN_RAD = 0.6;
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
const SUMMIT_SHORT_M = 300;
const SUMMIT_UP_M = 110;

export function titleScene(w: TitleWorld): Scene {
  const onGround = (x: number, z: number, up: number): Look => ({ x, y: w.ground(x, z) + up, z });
  const toPeak = { x: w.peak.x - w.start.x, z: w.peak.z - w.start.z };
  const peakDist = Math.hypot(toPeak.x, toPeak.z);
  const dir = { x: toPeak.x / peakDist, z: toPeak.z / peakDist };
  const peakLook = onGround(w.peak.x, w.peak.z, 0);
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

  // 2. Over the forest: from a quarter of the way to the peak, gliding toward it.
  const glideFrom = onGround(w.start.x + toPeak.x * CANOPY_ALONG, w.start.z + toPeak.z * CANOPY_ALONG, CANOPY_UP_M);

  // 3. The lake (a meadow where there is none, the hills where neither): from beyond its rim on the
  // trail's side, panning across it.
  const pond = w.water ?? (w.meadow === null ? null : { ...w.meadow, level: w.ground(w.meadow.x, w.meadow.z) });
  const third = (): Cut["shot"] => {
    if (pond === null) return holdLookingAt(onGround(w.start.x, w.start.z, HILLS_UP_M), () => peakLook);
    const back = Math.atan2(w.start.x - pond.x, w.start.z - pond.z);
    const out = pond.radius + SHORE_OUT_M;
    const ex = pond.x + Math.sin(back) * out, ez = pond.z + Math.cos(back) * out;
    const eye: Look = { x: ex, y: Math.max(pond.level, w.ground(ex, ez)) + SHORE_UP_M, z: ez };
    const across = back + Math.PI;
    return holdLookingAt(eye, (t) => {
      const a = across - PAN_RAD / 2 + PAN_RAD * Math.min(1, t / SHOT_S);
      return { x: eye.x + Math.sin(a) * out, y: pond.level, z: eye.z + Math.cos(a) * out };
    });
  };

  // 4. The trailhead: behind the start, rising, looking up the trail.
  const sy = Math.sin(w.start.yaw), cy = Math.cos(w.start.yaw);
  const riseX = w.start.x - sy * START_BACK_M, riseZ = w.start.z - cy * START_BACK_M;
  const trailLook = onGround(w.start.x + sy * TRAIL_LOOK_M, w.start.z + cy * TRAIL_LOOK_M, 3);

  // 5. The summit: from the trail's side, pushing toward the peak.
  const summitFrom = onGround(w.peak.x - dir.x * SUMMIT_SHORT_M, w.peak.z - dir.z * SUMMIT_SHORT_M, SUMMIT_UP_M);

  const s = TITLE_SHOTS;
  const cuts: Cut[] = [
    { ...s[0]!, shot: drift(coastFrom, coastTo, SHOT_S, coveLook) },
    { ...s[1]!, shot: drift(glideFrom, ahead(glideFrom), SHOT_S, peakLook) },
    { ...s[2]!, shot: third() },
    { ...s[3]!, shot: drift(onGround(riseX, riseZ, RISE_FROM_M), onGround(riseX, riseZ, RISE_TO_M), SHOT_S, trailLook) },
    { ...s[4]!, shot: drift(summitFrom, ahead(summitFrom), SHOT_S, peakLook) },
  ];
  return { duration: TITLE_DURATION, camera: cutList(cuts), actors: [], car: null, captions: [], black: () => 0 };
}
