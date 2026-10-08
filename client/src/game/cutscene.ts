/**
 * The summit scene (docs/gameplay/2026-10-08-the-summit-scene.md): the find,
 * in the game itself. From the frame the phase flips, the camera is the
 * scene's for SUMMIT_REVEAL_S: it comes down and in to the body, holds
 * while the Hollow rises behind it and the cry comes, and goes back to the
 * player's eye as the cast turns. A pure function of the seconds since the
 * flip, the pose the player had and where the body lies, as the endings
 * are (ending.ts). Babylon-free.
 */
import { easeOut } from "./ending.js";

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export type ScenePose = { x: number; y: number; z: number; yaw: number; pitch: number };
export type SceneBase = { x: number; y: number; z: number; yaw: number; pitch: number };

/** Seconds the camera takes to come in, when it starts back, and how long that takes. */
export const SCENE_IN_S = 2.5;
export const SCENE_OUT_FROM_S = 9;
export const SCENE_OUT_S = 3;
/** The eye's stand-off from the body (metres) and its height over the body's ground, crouched. */
export const SCENE_STAND_M = 2.6;
export const SCENE_EYE_HEIGHT = 0.9;
/** How far down the camera looks at the body, radians (down is positive). */
export const SCENE_PITCH = 0.42;

/** Slow in, slow out. */
export function easeInOut(t: number): number {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
}

/** Where the scene's camera stands: SCENE_STAND_M from the body toward where the eye was, at SCENE_EYE_HEIGHT over the body, looking at it. */
export function sceneStand(base: SceneBase, body: { x: number; y: number; z: number }): ScenePose {
  const dx = base.x - body.x, dz = base.z - body.z;
  const len = Math.hypot(dx, dz);
  const ux = len > 1e-6 ? dx / len : 0, uz = len > 1e-6 ? dz / len : 1;
  const x = body.x + ux * SCENE_STAND_M, z = body.z + uz * SCENE_STAND_M;
  return { x, y: body.y + SCENE_EYE_HEIGHT, z, yaw: Math.atan2(body.x - x, body.z - z), pitch: SCENE_PITCH };
}

/** The shortest turn from `a` to `b`, radians. */
function turn(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function mix(a: ScenePose, b: ScenePose, t: number): ScenePose {
  return {
    x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
    yaw: a.yaw + turn(a.yaw, b.yaw) * t, pitch: a.pitch + (b.pitch - a.pitch) * t,
  };
}

/** The cap's scene: seconds to turn to it, when the camera starts back, how long that takes, the step toward it, and how far down to look at a thing on the ground. */
export const CAP_SCENE_IN_S = 1;
export const CAP_SCENE_OUT_FROM_S = 3.4;
export const CAP_SCENE_OUT_S = 1;
export const CAP_SCENE_STEP_M = 0.6;
export const CAP_SCENE_S = CAP_SCENE_OUT_FROM_S + CAP_SCENE_OUT_S;

/** Where the cap's scene looks from: a step toward the cap from the eye, turned to it and tipped down to it. */
export function capStand(base: SceneBase, cap: { x: number; y: number; z: number }): ScenePose {
  const dx = cap.x - base.x, dz = cap.z - base.z;
  const len = Math.hypot(dx, dz);
  const ux = len > 1e-6 ? dx / len : 0, uz = len > 1e-6 ? dz / len : 1;
  const step = Math.min(CAP_SCENE_STEP_M, Math.max(0, len - 1.2));
  const x = base.x + ux * step, z = base.z + uz * step;
  const d = Math.max(0.5, len - step);
  return { x, y: base.y, z, yaw: Math.atan2(cap.x - x, cap.z - z), pitch: Math.atan2(base.y - cap.y, d) };
}

/** The camera `t` seconds into the cap's scene: turned to the cap over CAP_SCENE_IN_S, held, and back. */
export function capPose(t: number, base: SceneBase, cap: { x: number; y: number; z: number }): ScenePose {
  const stand = capStand(base, cap);
  if (t < CAP_SCENE_IN_S) return mix(base, stand, easeInOut(t / CAP_SCENE_IN_S));
  if (t < CAP_SCENE_OUT_FROM_S) return stand;
  return mix(stand, base, easeInOut((t - CAP_SCENE_OUT_FROM_S) / CAP_SCENE_OUT_S));
}

/**
 * The summit scene's five shots (docs/gameplay/2026-10-08-the-summit-scene.md, "The shots"), each a job of
 * the research's five (csarko.sh/research/opening-a-game-like-a-film): the arrival (place and
 * person), the find (problem), the reveal (the wrong note made whole), the predator's view (why
 * to run) and the threshold (the player's own eye again). Hard cuts between them, one slow move
 * within each, a film lens on all but the last: SHOTS gives each its seconds, and `summitShot`
 * its camera.
 */
export type SceneContext = {
  /** The eye the player had at the flip. */
  base: SceneBase;
  /** The body, the Hollow's feet, and the local player's eye, as the scene found them. */
  body: { x: number; y: number; z: number };
  hollow: { x: number; y: number; z: number };
  party: { x: number; y: number; z: number };
};
export type ShotPose = ScenePose & { fov: number; shot: number };

/** The film lenses in the engine's vertical radians: 24 mm, 32 mm, 50 mm; and the game's own. */
export const LENS_24 = 0.57;
export const LENS_32 = 0.43;
export const LENS_50 = 0.28;
export const LENS_GAME = 1.4;
/** Each shot's seconds, in order; the scene is their sum (SUMMIT_REVEAL_S matches it). */
export const SHOTS: readonly number[] = [4, 4, 5, 4, 3];
export const SUMMIT_SCENE_S = SHOTS.reduce((a, b) => a + b, 0);
/** The Hollow's head over its feet, drawn at HOLLOW_SCALE. */
export const HOLLOW_HEAD_M = 4.5;
/** The hiker on the pole, over its foot: the body is the top of a 4.3 m stake (bodyMesh.ts). */
export const BODY_TOP_M = 3.6;

function unit(dx: number, dz: number): { x: number; z: number } {
  const len = Math.hypot(dx, dz);
  return len > 1e-6 ? { x: dx / len, z: dz / len } : { x: 0, z: 1 };
}

/** A camera at `at` looking at `to`. */
function lookAt(at: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, fov: number, shot: number): ShotPose {
  const dx = to.x - at.x, dz = to.z - at.z;
  return { x: at.x, y: at.y, z: at.z, yaw: Math.atan2(dx, dz), pitch: Math.atan2(at.y - to.y, Math.hypot(dx, dz)), fov, shot };
}

/** The shot `t` seconds into the scene, and the seconds into that shot. */
export function shotAt(t: number): { shot: number; into: number } {
  let left = Math.max(0, t);
  for (let i = 0; i < SHOTS.length; i++) {
    const s = SHOTS[i] as number;
    if (left < s || i === SHOTS.length - 1) return { shot: i, into: Math.min(left, s) };
    left -= s;
  }
  return { shot: SHOTS.length - 1, into: 0 };
}

/**
 * The camera `t` seconds into the scene. `u` runs from the body toward the party; `p` is across it.
 * 1. The arrival: a 24 mm over the party's shoulder, no face, pushing slowly up the last of the trail,
 *    the stake ahead crossing the frame, what is on it unremarked.
 * 2. The find: a 32 mm low at the stake's foot, tilting up it to the hiker against the sky.
 * 3. The reveal: a 24 mm on the ground beside the stake, panning from the hiker to the Hollow's head
 *    as it stands; the cry comes here.
 * Every shot is lit by the sky alone: the summit at night has no other light, so each frames its
 *    subject against it.
 * 4. The predator's view: a 32 mm high behind the Hollow's shoulder, the party small below, a slow push.
 * 5. The threshold: the player's own eye at the game's lens, the cast turning; then the controls.
 */
export function summitShot(t: number, ctx: SceneContext): ShotPose {
  const { shot, into } = shotAt(t);
  const u = unit(ctx.party.x - ctx.body.x, ctx.party.z - ctx.body.z);
  const p = { x: -u.z, z: u.x };
  const body = ctx.body;
  const k = SHOTS[shot] as number;
  const f = Math.min(1, into / k);
  if (shot === 0) {
    const back = 2.4 - easeInOut(f) * 0.9;
    const at = { x: ctx.party.x + u.x * back + p.x * 0.8, y: ctx.party.y + 0.6, z: ctx.party.z + u.z * back + p.z * 0.8 };
    return lookAt(at, { x: body.x, y: body.y + 1.6, z: body.z }, LENS_24, 0);
  }
  if (shot === 1) {
    const at = { x: body.x + u.x * 2.4 + p.x * 0.8, y: body.y + 0.5, z: body.z + u.z * 2.4 + p.z * 0.8 };
    const up = easeInOut(f);
    return lookAt(at, { x: body.x, y: body.y + 0.6 + (BODY_TOP_M - 0.6) * up, z: body.z }, LENS_32, 1);
  }
  if (shot === 2) {
    const at = { x: body.x + p.x * 1.6 + u.x * 0.6, y: body.y + 0.35, z: body.z + p.z * 1.6 + u.z * 0.6 };
    const head = { x: ctx.hollow.x, y: ctx.hollow.y + HOLLOW_HEAD_M, z: ctx.hollow.z };
    const low = { x: body.x, y: body.y + BODY_TOP_M, z: body.z };
    const tilt = easeInOut(f);
    const aim = { x: low.x + (head.x - low.x) * tilt, y: low.y + (head.y - low.y) * tilt, z: low.z + (head.z - low.z) * tilt };
    return lookAt(at, aim, LENS_24, 2);
  }
  if (shot === 3) {
    const push = easeInOut(f) * 1.2;
    const at = { x: ctx.hollow.x - u.x * (4.5 - push) + p.x * 1.8, y: ctx.hollow.y + 5.2, z: ctx.hollow.z - u.z * (4.5 - push) + p.z * 1.8 };
    return lookAt(at, { x: ctx.party.x, y: ctx.party.y - 0.6, z: ctx.party.z }, LENS_32, 3);
  }
  return { x: ctx.base.x, y: ctx.base.y, z: ctx.base.z, yaw: ctx.base.yaw, pitch: ctx.base.pitch, fov: LENS_GAME, shot: 4 };
}

/** The camera `t` seconds into the scene, from `base` (the eye at the flip) toward the body, and back: the first scene, kept for the cap's and the tests of the way in. */
/** The camera `t` seconds into the scene, from `base` (the eye at the flip) toward the body, and back. */
export function summitPose(t: number, base: SceneBase, body: { x: number; y: number; z: number }): ScenePose {
  const stand = sceneStand(base, body);
  if (t < SCENE_IN_S) return mix(base, stand, easeOut(t / SCENE_IN_S));
  if (t < SCENE_OUT_FROM_S) return stand;
  return mix(stand, base, easeInOut((t - SCENE_OUT_FROM_S) / SCENE_OUT_S));
}
