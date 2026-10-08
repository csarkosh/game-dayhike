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

/** The camera `t` seconds into the scene, from `base` (the eye at the flip) toward the body, and back. */
export function summitPose(t: number, base: SceneBase, body: { x: number; y: number; z: number }): ScenePose {
  const stand = sceneStand(base, body);
  if (t < SCENE_IN_S) return mix(base, stand, easeOut(t / SCENE_IN_S));
  if (t < SCENE_OUT_FROM_S) return stand;
  return mix(stand, base, easeInOut((t - SCENE_OUT_FROM_S) / SCENE_OUT_S));
}
