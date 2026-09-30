/**
 * Camera shots as functions of time, and the cuts between them. Pure: a
 * shot takes the seconds into itself and gives a camera pose; a cut list
 * turns a scene's time into the running shot's own. The conventions are the
 * renderer's free camera's: yaw 0 faces +z, positive pitch looks down.
 */
import type { CameraPose } from "./timeline.js";

/** The film's default lens: 0.43 rad vertical, a 32 mm lens on Super 35. */
export const FILM_FOV = 0.43;
/** The coastal wide's lens is 0.10 to 0.14 rad; nothing goes wider than
 * 0.57 rad but the one cab shot. */
export const FOV_MIN = 0.1;
export const FOV_MAX = 0.57;

export type Look = { x: number; y: number; z: number };
/** A shot: seconds into it → the camera. */
export type Shot = (t: number) => CameraPose;
export type Cut = { from: number; to: number; shot: Shot };

/** Smoothstep on [0, 1]. */
export function ease(u: number): number {
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
}

export function lookAt(from: Look, at: Look, fov = FILM_FOV, roll = 0, dof = false): CameraPose {
  const dx = at.x - from.x, dy = at.y - from.y, dz = at.z - from.z;
  const flat = Math.sqrt(dx * dx + dz * dz);
  // `|| 0` turns the -0 a level look computes into 0, so a pose compares equal to a written one.
  return { x: from.x, y: from.y, z: from.z, yaw: Math.atan2(dx, dz) || 0, pitch: Math.atan2(-dy, flat) || 0, fov, roll, dof };
}

export function hold(pose: CameraPose): Shot {
  return () => pose;
}

/** A locked-off camera that keeps a moving point in its centre. */
export function holdLookingAt(from: Look, at: (t: number) => Look, fov = FILM_FOV): Shot {
  return (t) => lookAt(from, at(t), fov);
}

/**
 * A camera carried by a target: `offset` is in the target's own frame (x
 * to its right, z ahead), turned by its yaw; the camera looks the way the
 * target faces, tilted by `pitch`.
 */
export function follow(
  target: (t: number) => { x: number; y: number; z: number; yaw: number },
  offset: (t: number) => Look,
  fov = FILM_FOV,
  pitch = 0,
): Shot {
  return (t) => {
    const p = target(t);
    const o = offset(t);
    const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
    return { x: p.x + o.x * c + o.z * s, y: p.y + o.y, z: p.z - o.x * s + o.z * c, yaw: p.yaw, pitch, fov, roll: 0, dof: false };
  };
}

/** A move from `from` to `to` over `seconds` with an ease, looking at `at`; then held. */
export function push(from: Look, to: Look, seconds: number, at: Look, fov = FILM_FOV): Shot {
  return (t) => {
    const u = ease(seconds > 0 ? t / seconds : 1);
    return lookAt({ x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u, z: from.z + (to.z - from.z) * u }, at, fov);
  };
}

/** The running cut's shot at the scene's `t`, on the shot's own clock; past
 * the last cut, the last cut's shot at its end. */
export function cutList(cuts: readonly Cut[]): (t: number) => CameraPose {
  return (t) => {
    for (const c of cuts) if (t >= c.from && t < c.to) return c.shot(t - c.from);
    const last = cuts[cuts.length - 1];
    if (last === undefined) throw new Error("a cut list needs one cut");
    return t < last.from ? last.shot(0) : last.shot(last.to - last.from);
  };
}

/** Black over the first `inSeconds`, the picture until `outAt`, black by `duration`. */
export function fade(inSeconds: number, outAt: number, duration: number): (t: number) => number {
  return (t) => {
    if (t < inSeconds) return 1 - t / inSeconds;
    if (t > outAt) return Math.min(1, (t - outAt) / Math.max(1e-6, duration - outAt));
    return 0;
  };
}
