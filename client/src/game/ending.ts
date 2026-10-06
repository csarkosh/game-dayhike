/**
 * The last thing a player sees (docs/gameplay/2026-10-06-the-end-screens.md):
 * the match won, the camera lifts to the sky and the picture softens under
 * a line; the player dead, the body goes down on its back, the eyes to the
 * sky, and the dark closes to black under another. A pure function of the
 * seconds since the end began and the pose the player had, so the renderer
 * applies it and the tests pin it. Babylon-free.
 */

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export type EndingKind = "won" | "died";

/** The pose the camera had as the end began: the eye, and the look. */
export type EndingBase = { x: number; y: number; z: number; yaw: number; pitch: number; feetY: number };

/** What the renderer applies: the eye, the look, how soft the picture is and how far the dark has closed, each 0 to 1. */
export type EndingPose = { x: number; y: number; z: number; yaw: number; pitch: number; roll: number; blur: number; close: number };

/** The win: seconds the lift takes, where it ends (radians, up is negative), when the softening starts and how long it takes. */
export const WON_LIFT_S = 5;
export const WON_LIFT_PITCH = -0.85;
export const WON_BLUR_FROM_S = 0.8;
export const WON_BLUR_S = 3.5;
/** The death: seconds the fall takes, the eye's height off the ground on its back, the look (near straight up), the roll the head settles at, when the dark starts closing and how long it takes. */
export const DIED_FALL_S = 1.3;
export const DIED_EYE_HEIGHT = 0.22;
export const DIED_PITCH = -1.38;
export const DIED_ROLL = 0.18;
export const DIED_CLOSE_FROM_S = 1.0;
export const DIED_CLOSE_S = 3;

/** Fast then slow: a cubic ease out. */
export function easeOut(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

/** Slow then fast: a quadratic ease in, a body giving way. */
export function easeIn(t: number): number {
  const u = clamp01(t);
  return u * u;
}

/** The pose `t` seconds into an ending of `kind` from `base`. */
export function endingPose(kind: EndingKind, t: number, base: EndingBase): EndingPose {
  if (kind === "won") {
    const lift = easeOut(t / WON_LIFT_S);
    return {
      x: base.x, y: base.y, z: base.z, yaw: base.yaw,
      pitch: base.pitch + (WON_LIFT_PITCH - base.pitch) * lift,
      roll: 0,
      blur: clamp01((t - WON_BLUR_FROM_S) / WON_BLUR_S),
      close: 0,
    };
  }
  const fall = easeIn(t / DIED_FALL_S);
  return {
    x: base.x,
    y: base.y + (base.feetY + DIED_EYE_HEIGHT - base.y) * fall,
    z: base.z,
    yaw: base.yaw,
    pitch: base.pitch + (DIED_PITCH - base.pitch) * fall,
    roll: DIED_ROLL * fall,
    blur: 0,
    close: clamp01((t - DIED_CLOSE_FROM_S) / DIED_CLOSE_S),
  };
}
