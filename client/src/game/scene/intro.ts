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
import { cutList, ease, fade, follow, followLookingAt, holdLookingAt, push, type Cut } from "./shots.js";
import type { ActorPose, CarPose, Caption, Scene } from "./timeline.js";

export const INTRO_SEED_TOKEN = "hollow";
export const INTRO_HOUR = 12;
export const INTRO_WEATHER: WeatherParams = WEATHER_PRESETS.mist;
export const INTRO_DURATION = 72;
export const INTRO_RANGER = "ranger.nathan";
export const INTRO_CAR = "intro.car";

/** The eight shots of §3, in seconds: the cab, the insert and the shoulder
 * hold the call, which runs from 15 s to 51.9 s. */
export const INTRO_SHOTS: readonly { from: number; to: number }[] = [
  { from: 0, to: 9 }, { from: 9, to: 15 }, { from: 15, to: 30.6 }, { from: 30.6, to: 38.4 },
  { from: 38.4, to: 48 }, { from: 48, to: 55 }, { from: 55, to: 62 }, { from: 62, to: 72 },
];

/** The car's drive: from this far down the road, at a cruise, braking over
 * the last seconds to the site (12 m/s for 48 s and a 7 s brake). */
const DRIVE_M = 618;
const CRUISE_MPS = 12;
const BRAKE_S = 7;
/** The car's lane: metres right of the centreline. */
const LANE_M = 1.8;
/** The car stops at the end of shot 6, the door opens through shot 7. */
const STOP_AT_S = 55;
const DOOR_OPEN_S = 1.5;
/** The ranger steps from the door and walks to the spawn over shot 7. */
const STEP_OUT_S = 55.5;
const WALK_S = 5;
/** Shot 5's camera: this far back along the road from the car's site, which
 * the cruising car reaches at 41.6 s. */
const PASS_BACK_M = 119;
/** Where the ranger appears beside the car: at the driver's door, the car's left when it faces +z. */
const DOOR_X_M = -1.0;
const DOOR_Z_M = 0.6;
/** The cab shots ride the car: the back seat and the handset's place, in the car's frame. */
const BACK_SEAT = { x: -0.3, y: 1.05, z: -0.9 };
const HANDSET = { x: 0.35, y: 0.95, z: 0.45 };
/** The one wide lens, the cab; the coastal wide's lens; the insert's; the trail's. */
const CAB_FOV = 0.9;
/** The mist of the film's world hides everything past about 100 m, so the
 * coastal wide is shot from 80 m out over the water with a 0.25 rad lens
 * rather than the 0.12 rad long lens from far off, which would see fog alone. */
const COAST_FOV = 0.25;
const COAST_OUT_M = 70;
const COAST_UP_M = 38;
const COAST_AHEAD_M = 45;
const INSERT_FOV = 0.3;
const TRAIL_FOV = 0.5;

export type IntroPlaces = {
  car: { x: number; z: number };
  start: { x: number; z: number; yaw: number };
  board: { x: number; z: number };
  direction: 1 | -1;
};

/** The call's ten lines against the video's clock, each from its start to
 * the next line's, line 9 in two at the pause before "If anything";
 * dispatch's marked as heard through the radio. */
export const INTRO_CAPTIONS: readonly Caption[] = [
  { from: 15.0, to: 17.14, text: "Four-one, dispatch.", radio: true },
  { from: 17.14, to: 19.04, text: "Four-one. Go ahead.", radio: false },
  { from: 19.04, to: 23.82, text: "We've had reports of a missing hiker.\nLast seen at Trail 14.", radio: true },
  { from: 23.82, to: 26.28, text: "Copy. Anyone see them come down?", radio: false },
  { from: 26.28, to: 30.58, text: "Last sighting was near the summit.\nThe caller didn't leave a name.", radio: true },
  { from: 30.58, to: 33.52, text: "All right. Who's meeting me out there?", radio: false },
  { from: 33.52, to: 35.98, text: "I've got nobody else to send.", radio: true },
  { from: 35.98, to: 41.24, text: "Figures. I'm ten minutes out.\nUp to the summit and back before dark.", radio: false },
  { from: 41.24, to: 45.46, text: "Four-one, be advised,\nradio won't carry past the road.", radio: true },
  { from: 45.46, to: 48.42, text: "If anything... ...get back to the road.", radio: true },
  { from: 48.42, to: 51.86, text: "Dispatch, you're breaking up.\n...Dispatch?", radio: false },
];

export function introScene(road: Road, places: IntroPlaces): Scene {
  const dir = places.direction;
  const startZ = places.car.z - dir * DRIVE_M;
  // The lane eases from the driving lane onto the shoulder at the car's
  // site over the brake, so the car stops where the hike's car stands.
  const brakeFrom = STOP_AT_S - BRAKE_S;
  const shoulder = (places.car.x - road.centerX(places.car.z)) * dir;
  const lane = (t: number): number => LANE_M + (shoulder - LANE_M) * ease((t - brakeFrom) / BRAKE_S);
  const drive = carAlong(road, startZ, stopAt(DRIVE_M, CRUISE_MPS, BRAKE_S), lane, dir);
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
  const boardTop = { x: places.board.x, y: ground(places.board.x, places.board.z) + 1.8, z: places.board.z };
  const trailAndBoard = { x: trailAhead.x * 0.7 + boardTop.x * 0.3, y: trailAhead.y * 0.7 + boardTop.y * 0.3, z: trailAhead.z * 0.7 + boardTop.z * 0.3 };

  const s = INTRO_SHOTS;
  const cuts: Cut[] = [
    // 1. Wide over the water and the mist, the car small on the coast road
    //    from up and out over the sea, as far as the mist lets a lens see;
    //    the trailhead out of frame.
    { ...s[0]!, shot: holdLookingAt({ x: seaSide(road.centerX(startZ + dir * COAST_AHEAD_M), COAST_OUT_M), y: ground(road.centerX(startZ), startZ) + COAST_UP_M, z: startZ + dir * COAST_AHEAD_M }, (t) => carLook(t), COAST_FOV) },
    // 2. Along the road from the sea side: a beat behind the car, then level
    //    with it, the car kept in the frame's centre.
    { ...s[1]!, shot: followLookingAt((t) => carAt(t + s[1]!.from), (t) => ({ x: -6, y: 1.5, z: -22 + 22 * ease(t / 6) }), () => ({ x: 0, y: 1, z: 0 })) },
    // 3. The cab from the back seat: the one wide lens.
    { ...s[2]!, shot: follow((t) => carAt(t + s[2]!.from), () => BACK_SEAT, CAB_FOV, 0.05) },
    // 4. The handset and the hand that holds it: the insert, depth of field on.
    { ...s[3]!, shot: (t) => ({ ...follow((u) => carAt(u + s[3]!.from), () => HANDSET, INSERT_FOV, 0.55)(t), dof: true }) },
    // 5. Low on the shoulder, the car passing close into the treeline.
    { ...s[4]!, shot: holdLookingAt({ x: seaSide(road.centerX(carSite.z - dir * (PASS_BACK_M - 5)), 4), y: ground(road.centerX(carSite.z - dir * (PASS_BACK_M - 5)), carSite.z - dir * (PASS_BACK_M - 5)) + 0.5, z: carSite.z - dir * PASS_BACK_M }, (t) => carLook(t + s[4]!.from)) },
    // 6. A locked-off wide as the car slows onto the shoulder by the board.
    { ...s[5]!, shot: holdLookingAt({ x: seaSide(carSite.x, 18), y: carSite.y + 1.6, z: carSite.z - dir * 26 }, (t) => carLook(t + s[5]!.from), 0.35) },
    // 7. The door, the step onto gravel, the ranger from behind facing the trail.
    { ...s[6]!, shot: holdLookingAt({ x: carSite.x - dir * 4, y: carSite.y + 1.4, z: carSite.z - dir * 7 }, (t) => rangerLook(t + s[6]!.from)) },
    // 8. A slow push past the ranger's shoulder onto the trail, the board in
    //    view: the look is aimed between the trail ahead and the board.
    { ...s[7]!, shot: push(
      { x: places.start.x - Math.sin(places.start.yaw) * 2.2 + Math.cos(places.start.yaw) * 0.6, y: ground(places.start.x, places.start.z) + 1.6, z: places.start.z - Math.cos(places.start.yaw) * 2.2 - Math.sin(places.start.yaw) * 0.6 },
      { x: places.start.x + Math.sin(places.start.yaw) * 1.5 + Math.cos(places.start.yaw) * 0.6, y: ground(places.start.x, places.start.z) + 1.6, z: places.start.z + Math.cos(places.start.yaw) * 1.5 - Math.sin(places.start.yaw) * 0.6 },
      7, trailAndBoard, TRAIL_FOV,
    ) },
  ];

  return {
    duration: INTRO_DURATION,
    camera: cutList(cuts),
    actors: [ranger],
    car,
    captions: INTRO_CAPTIONS,
    // The film ends on the held picture: the black after it, and the title
    // card over it, are the playback's, and the last frame is the still's.
    black: fade(2, INTRO_DURATION, INTRO_DURATION),
  };
}
