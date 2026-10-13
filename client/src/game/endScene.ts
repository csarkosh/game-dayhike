/**
 * The end scene (docs/gameplay/2026-10-12-the-end-scene.md §1): the match
 * won, the ranger runs the last of the way to the car with the shades after
 * them, the engine catches and the car goes down the highway with the
 * camera left in the air over it. Four shots, hard cuts between them, a film
 * lens on all: the run (carried by the runner), the pursuit (locked off at
 * the car's tail), the door and the engine (locked off on the road's far
 * shoulder), the road (over the car, then left behind it). A pure function
 * of the seconds since the win, the runner's body, the car's site and the
 * road, as the summit's shots are (cutscene.ts). Babylon-free.
 */
import { CAR_HALF, CAR_ROAD_U } from "../sim/trailhead.js";
import { LENS_24, LENS_32, easeInOut, type ShotPose } from "./cutscene.js";
import { carAlong, type Road } from "./scene/roadPath.js";
import type { CarPose } from "./scene/timeline.js";

/** The run: the cut to the pursuit, and the most it lasts before the runner is in the car regardless. */
export const RUN_CUT_S = 2.5;
export const RUN_MAX_S = 10;
/** Shot 1, carried by the runner: metres behind, over their eye and to their right. */
export const RUN_CAM_BACK = 2.2;
export const RUN_CAM_UP = 0.5;
export const RUN_CAM_SIDE = 0.6;
/** Shot 2, at the car's rear corner: metres up, and out from the corner toward the runner. */
export const PURSUIT_CAM_UP = 0.7;
export const PURSUIT_CAM_OUT = 1.0;
/** The runner's chest over their feet, where shot 2 aims. */
export const CHEST_M = 1.3;
/** Shot 3, the door and the engine: its seconds, and the camera's height and its place ahead of the car. */
export const ENGINE_SHOT_S = 5.5;
export const ENGINE_CAM_UP = 0.6;
export const ENGINE_CAM_AHEAD = 7;
/** Shot 3 aims at the car's nose this far over its ground. */
export const ENGINE_AIM_UP = 0.5;
/** Shot 4, the road: over the car, carried, released, and tilted from straight down to the road ahead. */
export const ROAD_CAM_UP = 14;
export const ROAD_CARRY_S = 2;
export const ROAD_RELEASE_S = 1;
export const ROAD_TILT_TO = 0.06;
/** Shot 4's first look: a hair short of straight down, so the look has a heading. */
export const ROAD_LOOK_DOWN = 1.55;
/** The scene after the arrival; shot 3 is its first `ENGINE_SHOT_S`, the road the rest. */
export const END_SCENE_AFTER_ARRIVAL_S = 17.5;
export const ROAD_SHOT_S = END_SCENE_AFTER_ARRIVAL_S - ENGINE_SHOT_S;
/** Seconds after the arrival the road begins: the beats below are counted from it. */
export const END_ROAD_AT_S = ENGINE_SHOT_S;
/** Into the road: the title and its line, the dark, the title page. */
export const TITLE_AT_S = 2;
export const END_FADE_AT_S = 10;
export const END_LANDING_AT_S = 15;
/** The runner is in: within this of the door spot. Bodies within `DOOR_IN_M` of it are hidden. */
export const DOOR_REACH_M = 0.9;
export const DOOR_IN_M = 1.2;
/** The car: when it moves, after the arrival; how hard it pulls away; what it holds. */
export const PULL_AWAY_AT_S = 2.6;
export const PULL_AWAY_ACCEL = 3.5;
export const CRUISE_MPS = 14;
/** The lane it drives in, metres right of the centreline, and the metres it takes to reach it from the shoulder. */
export const LANE_M = 1.8;
export const LANE_CHANGE_M = 30;
/** The game's sound fading from the pull-away, and the master's from the dark. */
export const WORLD_FADE_S = 8;
export const MASTER_FADE_S = 2;
/** The console's `escape`: how far from the car, toward the trail, the host's player is put. */
export const ESCAPE_FROM_M = 14;
/**
 * The car's headlamps: the bodies' own lamps (lampParams.ts) moved to its
 * nose, this far apart and up, aimed this far down, at a wider cone and a
 * longer reach (radians and metres, as `LAMP_ANGLE` and `LAMP_RANGE`).
 */
export const HEADLAMP_APART = 1.2;
export const HEADLAMP_UP = 0.7;
export const HEADLAMP_DOWN = 0.1;
export const HEADLAMP_CONE = 1.9;
export const HEADLAMP_RANGE = 60;
/** The tail lamps: small red quads at the car's rear corners, this size, this far up, apart and back from its centre. */
export const TAIL_LAMP_COLOUR: readonly [number, number, number] = [1, 0.08, 0.04];
export const TAIL_LAMP_W = 0.25;
export const TAIL_LAMP_H = 0.1;
export const TAIL_LAMP_UP = 0.75;
export const TAIL_LAMP_APART = 1.4;
export const TAIL_LAMP_BACK = 2.2;

/** The four shots, in order; `endShot` gives each's index. */
export const END_SHOTS = ["run", "pursuit", "engine", "road"] as const;

type Ground = { x: number; z: number };

/** What the shots are framed from this frame. */
export type EndShotContext = {
  /** The runner's feet this frame, and their yaw. */
  runner: { x: number; y: number; z: number; yaw: number };
  /** The runner's eye height this frame, as the renderer draws the eye. */
  eyeY: number;
  /** The car's site, its ground's height there, and the way it faces (1 toward +z). */
  site: Ground;
  groundY: number;
  direction: 1 | -1;
  road: Road;
  /** The door spot (`doorSpot`, sim/trailhead.ts). */
  door: Ground;
  /** The second the runner reached the door, or null while they run. */
  arrival: number | null;
  /** Where the runner was at the cut to the pursuit, held from its first frame; null before it. */
  pursuitFrom: Ground | null;
};

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function unit(dx: number, dz: number): Ground {
  const len = Math.hypot(dx, dz);
  return len > 1e-6 ? { x: dx / len, z: dz / len } : { x: 0, z: 1 };
}

/** The shortest turn from `a` to `b`, radians. */
function turn(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/** A camera at `at` looking at `to`. */
function lookAt(at: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, fov: number, shot: number): ShotPose {
  const dx = to.x - at.x, dz = to.z - at.z;
  return { x: at.x, y: at.y, z: at.z, yaw: Math.atan2(dx, dz), pitch: Math.atan2(at.y - to.y, Math.hypot(dx, dz)), fov, shot, live: false };
}

/** Metres the car has gone along the road `t` seconds after the arrival. */
export function carDistance(t: number): number {
  const s = t - PULL_AWAY_AT_S;
  if (s <= 0) return 0;
  const reach = CRUISE_MPS / PULL_AWAY_ACCEL;
  if (s < reach) return 0.5 * PULL_AWAY_ACCEL * s * s;
  return 0.5 * PULL_AWAY_ACCEL * reach * reach + CRUISE_MPS * (s - reach);
}

/** The car's speed, m/s, `t` seconds after the arrival. */
export function carSpeed(t: number): number {
  const s = t - PULL_AWAY_AT_S;
  if (s <= 0) return 0;
  return Math.min(CRUISE_MPS, PULL_AWAY_ACCEL * s);
}

/**
 * The car's lane `distance` metres along, in `roadPose`'s terms (metres to
 * the right of the centreline as it drives): from `parked`, its place on
 * the shoulder, eased onto `LANE_M` on the same side of the road over the
 * first `LANE_CHANGE_M`.
 */
export function laneAt(distance: number, parked: number): number {
  const lane = parked < 0 ? -LANE_M : LANE_M;
  return parked + (lane - parked) * easeInOut(distance / LANE_CHANGE_M);
}

/** The lane's change per metre along at `distance`: the smoothstep's slope. */
function laneSlope(distance: number, parked: number): number {
  const u = clamp01(distance / LANE_CHANGE_M);
  const lane = parked < 0 ? -LANE_M : LANE_M;
  return ((lane - parked) * 6 * u * (1 - u)) / LANE_CHANGE_M;
}

/**
 * The car `t` seconds after the arrival: parked at its site, square to the
 * road as the hike placed it (`carYaw`), until `PULL_AWAY_AT_S`; then along
 * the road the way it faces (`carAlong`), off the shoulder onto its lane,
 * its heading turned from the parked one onto the road's over the lane
 * change and angled across by the change itself.
 */
export function endCar(t: number, road: Road, site: Ground, direction: 1 | -1): CarPose {
  const parkedYaw = direction === 1 ? 0 : Math.PI;
  const d = carDistance(t);
  if (d <= 0) {
    return { x: site.x, y: road.groundY(site.x, site.z), z: site.z, yaw: parkedYaw, wheelSpin: 0, doorOpen: 0, wheelTurn: 0, steer: 0, handset: "cradle" };
  }
  const parked = (site.x - road.centerX(site.z)) * direction;
  const pose = carAlong(road, site.z, () => d, laneAt(d, parked), direction)(t);
  pose.yaw = parkedYaw + turn(parkedYaw, pose.yaw) * easeInOut(d / LANE_CHANGE_M) + Math.atan(laneSlope(d, parked));
  return pose;
}

/** Which shot plays `t` seconds after the win, 0 to 3, with the arrival (or none yet). */
export function endShotIndex(t: number, arrival: number | null): number {
  const a = arrival ?? (t >= RUN_MAX_S ? RUN_MAX_S : null);
  if (a === null || t < a) return t < RUN_CUT_S ? 0 : 1;
  return t - a < ENGINE_SHOT_S ? 2 : 3;
}

/**
 * The camera `t` seconds after the win.
 * 1. The run: carried `RUN_CAM_BACK` behind the runner on the way to the door,
 *    `RUN_CAM_SIDE` to their right and `RUN_CAM_UP` over their eye, aimed at
 *    the door at their eye's height, so the car grows in the frame.
 * 2. The pursuit: locked off at the car's rear corner on the inland side,
 *    `PURSUIT_CAM_OUT` out toward where the runner was at the cut and
 *    `PURSUIT_CAM_UP` up, aimed at their chest as they come at the lens.
 * 3. The door and the engine: locked off low on the road's far shoulder,
 *    `ENGINE_CAM_AHEAD` ahead of the car, turning to keep its nose centred.
 * 4. The road: `ROAD_CAM_UP` over the car looking down, carried for
 *    `ROAD_CARRY_S`, eased to a stop over `ROAD_RELEASE_S`, and tilting from
 *    straight down to `ROAD_TILT_TO` over the shot's whole length.
 * Past the scene's end the last pose holds.
 */
export function endShot(t: number, ctx: EndShotContext): ShotPose {
  const shot = endShotIndex(t, ctx.arrival);
  const { runner, site, door, road, direction } = ctx;
  if (shot === 0) {
    const h = unit(door.x - runner.x, door.z - runner.z);
    // Right of the heading: yaw 0 faces +z, and its right is +x.
    const rx = h.z, rz = -h.x;
    const at = {
      x: runner.x - h.x * RUN_CAM_BACK + rx * RUN_CAM_SIDE,
      y: ctx.eyeY + RUN_CAM_UP,
      z: runner.z - h.z * RUN_CAM_BACK + rz * RUN_CAM_SIDE,
    };
    return lookAt(at, { x: door.x, y: ctx.eyeY, z: door.z }, LENS_24, 0);
  }
  if (shot === 1) {
    const corner = { x: site.x + CAR_HALF.x, z: site.z - direction * CAR_HALF.z };
    const from = ctx.pursuitFrom ?? runner;
    const out = unit(from.x - corner.x, from.z - corner.z);
    const at = { x: corner.x + out.x * PURSUIT_CAM_OUT, y: ctx.groundY + PURSUIT_CAM_UP, z: corner.z + out.z * PURSUIT_CAM_OUT };
    return lookAt(at, { x: runner.x, y: runner.y + CHEST_M, z: runner.z }, LENS_32, 1);
  }
  const a = ctx.arrival ?? RUN_MAX_S;
  const after = Math.min(t - a, END_SCENE_AFTER_ARRIVAL_S);
  const car = endCar(after, road, site, direction);
  if (shot === 2) {
    const z = site.z + direction * ENGINE_CAM_AHEAD;
    const x = road.centerX(z) - CAR_ROAD_U;
    const at = { x, y: road.groundY(x, z) + ENGINE_CAM_UP, z };
    const nose = { x: car.x + Math.sin(car.yaw) * CAR_HALF.z, y: car.y + ENGINE_AIM_UP, z: car.z + Math.cos(car.yaw) * CAR_HALF.z };
    return lookAt(at, nose, LENS_32, 2);
  }
  const into = after - ENGINE_SHOT_S;
  const held = endCar(ENGINE_SHOT_S + ROAD_CARRY_S, road, site, direction);
  const w = into <= ROAD_CARRY_S ? 0 : easeInOut((into - ROAD_CARRY_S) / ROAD_RELEASE_S);
  return {
    x: car.x + (held.x - car.x) * w,
    y: car.y + ROAD_CAM_UP + (held.y - car.y) * w,
    z: car.z + (held.z - car.z) * w,
    yaw: car.yaw + turn(car.yaw, held.yaw) * w,
    pitch: ROAD_LOOK_DOWN + (ROAD_TILT_TO - ROAD_LOOK_DOWN) * easeInOut(into / ROAD_SHOT_S),
    fov: LENS_24,
    shot: 3,
    live: false,
  };
}

/** The scene's beats `t` seconds after the win: each true from its second on, none before the arrival. */
export type EndBeats = { title: boolean; fade: boolean; landing: boolean; pullAway: boolean };

export function endBeats(t: number, arrival: number | null): EndBeats {
  if (arrival === null || t < arrival) return { title: false, fade: false, landing: false, pullAway: false };
  const after = t - arrival;
  return {
    title: after >= END_ROAD_AT_S + TITLE_AT_S,
    fade: after >= END_ROAD_AT_S + END_FADE_AT_S,
    landing: after >= END_ROAD_AT_S + END_LANDING_AT_S,
    pullAway: after >= PULL_AWAY_AT_S,
  };
}

/** Whether the runner is in: within `DOOR_REACH_M` of the door, or the run's time is up. */
export function arrived(runner: Ground, door: Ground, t: number): boolean {
  return Math.hypot(runner.x - door.x, runner.z - door.z) <= DOOR_REACH_M || t >= RUN_MAX_S;
}

/** A lamp's place and the way it points, in the world. */
export type LampAim = { x: number; y: number; z: number; dx: number; dy: number; dz: number };

/** A headlamp on the car: `side` 1 its right, −1 its left, at its nose, aimed along its heading and `HEADLAMP_DOWN` down. Writes `out`. */
export function headlampAt(car: { x: number; y: number; z: number; yaw: number }, side: 1 | -1, out: LampAim): LampAim {
  const hx = Math.sin(car.yaw), hz = Math.cos(car.yaw);
  const across = side * HEADLAMP_APART / 2;
  out.x = car.x + hx * CAR_HALF.z + hz * across;
  out.y = car.y + HEADLAMP_UP;
  out.z = car.z + hz * CAR_HALF.z - hx * across;
  const level = Math.cos(HEADLAMP_DOWN);
  out.dx = hx * level;
  out.dy = -Math.sin(HEADLAMP_DOWN);
  out.dz = hz * level;
  return out;
}

/**
 * The car as the listener hears it: its place relative to the ear in the
 * ear's own frame (x right, y up, z ahead, metres), which is Web Audio's
 * frame relative to its listener as `ambient.setCar` takes it. `ear` is the
 * camera in the game's world (`renderer.listener()`): its forward, and world
 * up, from which its right and its own up are made square to the forward,
 * so the place is as far from the ear as the car is. Writes `out`.
 */
export function carHeard(
  ear: { x: number; y: number; z: number; fx: number; fy: number; fz: number },
  car: { x: number; y: number; z: number },
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const dx = car.x - ear.x, dy = car.y - ear.y, dz = car.z - ear.z;
  // Right: world up across the forward (yaw 0 faces +z, its right +x).
  let rx = ear.fz, rz = -ear.fx;
  const rl = Math.hypot(rx, rz);
  if (rl > 1e-9) { rx /= rl; rz /= rl; } else { rx = 1; rz = 0; }
  // Up: the forward across the right.
  const ux = ear.fy * rz, uy = ear.fz * rx - ear.fx * rz, uz = -ear.fy * rx;
  out.x = dx * rx + dz * rz;
  out.y = dx * ux + dy * uy + dz * uz;
  out.z = dx * ear.fx + dy * ear.fy + dz * ear.fz;
  return out;
}
