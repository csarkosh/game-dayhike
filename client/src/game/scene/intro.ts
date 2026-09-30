/**
 * The intro scene's data: the world it plays on, the eight shots, the car's
 * drive to the trailhead, the ranger's step out, and the call's captions.
 * Pure: the road and the trailhead's places come from the sim through the
 * route, so this file names no seed's numbers. What the shots frame is
 * spec §3; the numbers here are the first staging and are tuned in the
 * browser (`docs/gameplay/2026-09-30-intro-staging-verification.md`).
 *
 * The frame: the road runs along z; the sea is toward -x and inland toward
 * +x, so "from the sea side" is a camera at a smaller x than the road.
 */
import { WEATHER_PRESETS, type WeatherParams } from "../weather.js";
import { carAlong, stopAt, type Road } from "./roadPath.js";
import { FILM_FOV, cutList, ease, fade, follow, holdLookingAt, push, type Cut } from "./shots.js";
import type { ActorPose, CarPose, Caption, Scene } from "./timeline.js";

export const INTRO_SEED_TOKEN = "hollow";
export const INTRO_HOUR = 12;
export const INTRO_WEATHER: WeatherParams = WEATHER_PRESETS.mist;
export const INTRO_DURATION = 60;
export const INTRO_RANGER = "ranger.nathan";
export const INTRO_CAR = "trailhead.car";

/** The eight shots of §3, in seconds. */
export const INTRO_SHOTS: readonly { from: number; to: number }[] = [
  { from: 0, to: 9 }, { from: 9, to: 15 }, { from: 15, to: 25 }, { from: 25, to: 30 },
  { from: 30, to: 36 }, { from: 36, to: 43 }, { from: 43, to: 50 }, { from: 50, to: 60 },
];

/** The car's drive: from this far down the road, at a cruise, braking over the last seconds to the site. */
const DRIVE_M = 470;
const CRUISE_MPS = 12;
const BRAKE_S = 7;
/** The car's lane: metres right of the centreline. */
const LANE_M = 1.8;
/** The car stops at the end of shot 6, the door opens through shot 7. */
const STOP_AT_S = 43;
const DOOR_OPEN_S = 1.5;
/** The ranger steps from the door and walks to the spawn over shot 7. */
const STEP_OUT_S = 43.5;
const WALK_S = 5;
/** Where the ranger appears beside the car: at the driver's door, the car's left when it faces +z. */
const DOOR_X_M = -1.0;
const DOOR_Z_M = 0.6;
/** The cab shots ride the car: the back seat and the handset's place, in the car's frame. */
const BACK_SEAT = { x: -0.3, y: 1.05, z: -0.9 };
const HANDSET = { x: 0.35, y: 0.95, z: 0.45 };
/** The one wide lens, the cab; the coastal wide's long lens; the insert's. */
const CAB_FOV = 0.9;
const COAST_FOV = 0.12;
const INSERT_FOV = 0.3;

export type IntroPlaces = {
  car: { x: number; z: number };
  start: { x: number; z: number; yaw: number };
  board: { x: number; z: number };
  direction: 1 | -1;
};

/** The call's ten lines against the video's clock, dispatch's marked as heard through the radio. */
export const INTRO_CAPTIONS: readonly Caption[] = [
  { from: 15.0, to: 16.4, text: "Four-one, dispatch.", radio: true },
  { from: 16.4, to: 17.8, text: "Four-one. Go ahead.", radio: false },
  { from: 17.8, to: 20.9, text: "We've had reports of a missing hiker.\nLast seen at Trail 14.", radio: true },
  { from: 20.9, to: 22.6, text: "Copy. Anyone see them come down?", radio: false },
  { from: 22.6, to: 26.0, text: "Last sighting was near the summit.\nThe caller didn't leave a name.", radio: true },
  { from: 26.0, to: 28.0, text: "All right. Who's meeting me out there?", radio: false },
  { from: 28.0, to: 29.5, text: "I've got nobody else to send.", radio: true },
  { from: 29.5, to: 33.0, text: "Figures. I'm ten minutes out.\nUp to the summit and back before dark.", radio: false },
  { from: 33.0, to: 35.8, text: "Four-one, be advised,\nradio won't carry past the road.", radio: true },
  { from: 35.8, to: 37.8, text: "If anything... ...get back to the road.", radio: true },
  { from: 37.8, to: 40.4, text: "Dispatch, you're breaking up.\n...Dispatch?", radio: false },
];

export function introScene(road: Road, places: IntroPlaces): Scene {
  const dir = places.direction;
  const startZ = places.car.z - dir * DRIVE_M;
  const drive = carAlong(road, startZ, stopAt(DRIVE_M, CRUISE_MPS, BRAKE_S), LANE_M, dir);
  const car = (t: number): CarPose => {
    const pose = drive(Math.min(t, STOP_AT_S));
    const door = t <= STOP_AT_S ? 0 : ease((t - STOP_AT_S) / DOOR_OPEN_S);
    return { ...pose, doorOpen: door };
  };
  const carAt = (t: number) => car(t);
  const seaSide = (x: number, m: number) => x - m;
  const carSite = drive(STOP_AT_S);
  const ground = (x: number, z: number) => road.groundY(x, z);

  // The ranger: unseen in the cab until the step out, then from the door to
  // the spawn over shot 7, then standing there facing the trail.
  const doorAt = { x: carSite.x + DOOR_X_M * dir, z: carSite.z + DOOR_Z_M * dir };
  const ranger = (t: number): ActorPose => {
    if (t < STEP_OUT_S) return { id: INTRO_RANGER, x: doorAt.x, y: carSite.y, z: doorAt.z, yaw: places.start.yaw, clip: "idle", clipTime: 0, visible: false };
    const u = ease((t - STEP_OUT_S) / WALK_S);
    const x = doorAt.x + (places.start.x - doorAt.x) * u;
    const z = doorAt.z + (places.start.z - doorAt.z) * u;
    const walking = u < 1;
    const yaw = walking ? Math.atan2(places.start.x - doorAt.x, places.start.z - doorAt.z) : places.start.yaw;
    return { id: INTRO_RANGER, x, y: ground(x, z), z, yaw, clip: walking ? "walk" : "idle", clipTime: t - STEP_OUT_S, visible: true };
  };

  const rangerLook = (t: number) => {
    const r = ranger(t);
    return { x: r.x, y: r.y + 1.5, z: r.z };
  };
  const carLook = (t: number) => {
    const c = carAt(t);
    return { x: c.x, y: c.y + 1, z: c.z };
  };
  const trailAhead = { x: places.start.x + Math.sin(places.start.yaw) * 12, y: ground(places.start.x, places.start.z) + 1.4, z: places.start.z + Math.cos(places.start.yaw) * 12 };

  const s = INTRO_SHOTS;
  const cuts: Cut[] = [
    // 1. Wide over the sea stacks and the mist, the car small on the coast
    //    road from high up and far out, a long lens; the trailhead out of frame.
    { ...s[0]!, shot: holdLookingAt({ x: seaSide(road.centerX(startZ), 380), y: ground(road.centerX(startZ), startZ) + 140, z: startZ - dir * 120 }, (t) => carLook(t), COAST_FOV) },
    // 2. Along the road from the sea side: a beat behind the car, then level with it.
    { ...s[1]!, shot: follow((t) => carAt(t + s[1]!.from), (t) => ({ x: -6, y: 1.5, z: -22 + 22 * ease(t / 6) })) },
    // 3. The cab from the back seat: the one wide lens.
    { ...s[2]!, shot: follow((t) => carAt(t + s[2]!.from), () => BACK_SEAT, CAB_FOV, 0.05) },
    // 4. The handset and the hand that holds it: the insert, depth of field on.
    { ...s[3]!, shot: (t) => ({ ...follow((u) => carAt(u + s[3]!.from), () => HANDSET, INSERT_FOV, 0.55)(t), dof: true }) },
    // 5. Low on the shoulder, the car passing close into the treeline.
    { ...s[4]!, shot: holdLookingAt({ x: seaSide(road.centerX(carSite.z - dir * 90), 4), y: ground(road.centerX(carSite.z - dir * 90), carSite.z - dir * 90) + 0.5, z: carSite.z - dir * 95 }, (t) => carLook(t + s[4]!.from)) },
    // 6. A locked-off wide as the car slows onto the shoulder by the board.
    { ...s[5]!, shot: holdLookingAt({ x: seaSide(carSite.x, 18), y: carSite.y + 1.6, z: carSite.z - dir * 26 }, (t) => carLook(t + s[5]!.from), 0.35) },
    // 7. The door, the step onto gravel, the ranger from behind facing the trail.
    { ...s[6]!, shot: holdLookingAt({ x: carSite.x - dir * 4, y: carSite.y + 1.4, z: carSite.z - dir * 7 }, (t) => rangerLook(t + s[6]!.from)) },
    // 8. A slow push past the ranger's shoulder onto the trail, then held.
    { ...s[7]!, shot: push(
      { x: places.start.x - Math.sin(places.start.yaw) * 2.2 + Math.cos(places.start.yaw) * 0.6, y: ground(places.start.x, places.start.z) + 1.6, z: places.start.z - Math.cos(places.start.yaw) * 2.2 - Math.sin(places.start.yaw) * 0.6 },
      { x: places.start.x + Math.sin(places.start.yaw) * 1.5 + Math.cos(places.start.yaw) * 0.6, y: ground(places.start.x, places.start.z) + 1.6, z: places.start.z + Math.cos(places.start.yaw) * 1.5 - Math.sin(places.start.yaw) * 0.6 },
      7, trailAhead, FILM_FOV,
    ) },
  ];

  return {
    duration: INTRO_DURATION,
    camera: cutList(cuts),
    actors: [ranger],
    car,
    captions: INTRO_CAPTIONS,
    black: fade(2, 57, INTRO_DURATION),
  };
}
