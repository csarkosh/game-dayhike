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
export const INTRO_RANGER = "intro.ranger";
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
/** Shot 5's camera: this far back along the road from the car's site, which
 * the cruising car reaches at 41.6 s. */
const PASS_BACK_M = 119;

/** The film car's steering wheel's centre in the car's frame (m), measured on the model. */
const STEERING_AT = { x: -0.411, y: 1.034, z: 0.594 };
/** The seated chest: the drive clips hold the wheel 0.1 m below the chest and 0.4 m ahead of it. */
const CHEST_SEAT = { x: STEERING_AT.x, y: STEERING_AT.y + 0.1, z: STEERING_AT.z - 0.4 };
/** The seated hips: 0.424 m below the chest in the first frame of `drive`. */
const HIPS_SEAT = { x: CHEST_SEAT.x, y: CHEST_SEAT.y - 0.424, z: CHEST_SEAT.z };
/** Where the stand-up ends: the hips 0.45 m outside the driver's door, at standing height. */
const HIPS_OUT = { x: -1.25, y: 0.95, z: 0.25 };
const CHEST = "chest";
const HIPS = "hips";
/** The handset at the mouth, in the car's frame: the talk clip's right hand, 0.04 m right, 0.2 m up and 0.1 m ahead of the chest. */
const HANDSET_HELD = { x: CHEST_SEAT.x + 0.04, y: CHEST_SEAT.y + 0.2, z: CHEST_SEAT.z + 0.1 };
/** The insert's camera, in the car's frame: across the cab, looking back at the handset. */
const INSERT_FROM = { x: 0.25, y: 1.3, z: 0.75 };

/** The ranger's performance, on the call's times (s). */
const REACH_AT = 15.0;
const HANDSET_TAKEN_AT = 15.6;
const TALK_AT = 16.5;
const LOWER_AT = 51.9;
const HANDSET_BACK_AT = 52.7;
const STEP_OUT_S = 58;
const WALK_S = 5;
/** The time two clips are mixed across at a change (s). */
const BLEND_S = 0.3;

/** A clip from its start: its length when it does not loop (null when it does), and where the ranger is. */
type Segment = { from: number; clip: string; seconds: number | null; place: "seat" | "stand-up" | "walk" | "spawn" };
const PERFORMANCE: readonly Segment[] = [
  { from: 0, clip: "drive", seconds: null, place: "seat" },
  { from: REACH_AT, clip: "reach", seconds: 1.5, place: "seat" },
  { from: TALK_AT, clip: "talk", seconds: null, place: "seat" },
  { from: LOWER_AT, clip: "lower", seconds: 2, place: "seat" },
  { from: LOWER_AT + 2, clip: "drive", seconds: null, place: "seat" },
  { from: STOP_AT_S, clip: "door", seconds: 3, place: "stand-up" },
  { from: STEP_OUT_S, clip: "walk", seconds: null, place: "walk" },
  { from: STEP_OUT_S + WALK_S, clip: "face_trail", seconds: 4, place: "spawn" },
];

/** How far into a segment's clip at `t`: a loop runs on, a clip that does not loop holds its last frame. */
function clipTimeOf(segment: Segment, t: number): number {
  const into = t - segment.from;
  return segment.seconds === null ? into : Math.min(into, segment.seconds - 1 / 60);
}
/** The cab shot rides the car: the back seat, in the car's frame. */
const BACK_SEAT = { x: -0.3, y: 1.05, z: -0.9 };
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
    const held = t >= HANDSET_TAKEN_AT && t < HANDSET_BACK_AT;
    return { ...pose, doorOpen: door, handset: held ? "hand" : "cradle" };
  };
  const carAt = (t: number) => car(t);
  const seaSide = (x: number, m: number) => x - m;
  const carSite = drive(STOP_AT_S);
  const ground = (x: number, z: number) => road.groundY(x, z);

  /** A point of the car's frame in the world at `t`, as `follow` places a camera. */
  const inCar = (t: number, p: { x: number; y: number; z: number }) => {
    const c = car(t);
    const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    return { x: c.x + p.x * co + p.z * s, y: c.y + p.y, z: c.z - p.x * s + p.z * co };
  };
  const ranger = (t: number): ActorPose => {
    let i = 0;
    while (i + 1 < PERFORMANCE.length && PERFORMANCE[i + 1]!.from <= t) i += 1;
    const segment = PERFORMANCE[i]!;
    const previous = i > 0 ? PERFORMANCE[i - 1]! : null;
    const into = t - segment.from;
    const blend = previous !== null && into < BLEND_S ? { clip: previous.clip, clipTime: clipTimeOf(previous, t), weight: 1 - ease(into / BLEND_S) } : undefined;
    const base = { id: INTRO_RANGER, clip: segment.clip, clipTime: clipTimeOf(segment, t), visible: true, ...(blend === undefined ? {} : { blend }) };
    const yaw = car(t).yaw;
    if (segment.place === "seat") {
      const at = inCar(t, CHEST_SEAT);
      return { ...base, ...at, yaw, anchor: { joint: CHEST, ...at } };
    }
    if (segment.place === "stand-up") {
      const u = ease(into / (segment.seconds ?? 1));
      const at = inCar(t, { x: HIPS_SEAT.x + (HIPS_OUT.x - HIPS_SEAT.x) * u, y: HIPS_SEAT.y + (HIPS_OUT.y - HIPS_SEAT.y) * u, z: HIPS_SEAT.z + (HIPS_OUT.z - HIPS_SEAT.z) * u });
      return { ...base, ...at, yaw, anchor: { joint: HIPS, ...at } };
    }
    if (segment.place === "walk") {
      const from = inCar(t, { x: HIPS_OUT.x, y: 0, z: HIPS_OUT.z });
      const u = ease(into / WALK_S);
      const x = from.x + (places.start.x - from.x) * u;
      const z = from.z + (places.start.z - from.z) * u;
      return { ...base, x, y: ground(x, z), z, yaw: Math.atan2(places.start.x - from.x, places.start.z - from.z) };
    }
    return { ...base, x: places.start.x, y: ground(places.start.x, places.start.z), z: places.start.z, yaw: places.start.yaw };
  };

  const rangerLook = (t: number) => {
    const r = ranger(t);
    // An anchored ranger's point is his chest or hips; a standing one's, his feet.
    return { x: r.x, y: r.y + (r.anchor === undefined ? 1.5 : 0.6), z: r.z };
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
    // 4. The handset at the ranger's mouth: the insert, across the cab, depth of field on.
    { ...s[3]!, shot: (t) => ({ ...followLookingAt((u) => carAt(u + s[3]!.from), () => INSERT_FROM, () => HANDSET_HELD, INSERT_FOV)(t), dof: true }) },
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
