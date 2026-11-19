/**
 * What is at the centre of a player's view in the chase
 * (docs/gameplay/2026-11-13-the-way-down.md): how near the middle of their
 * look the nearest shadow or hunter stands, 0 to 1. The chase's dark beats
 * faster by it (stareLens.ts). Each screen works it out for its own player
 * from its own crowd and the state's enemies; nothing of it is the host's.
 */

/** Degrees off the look within which a thing is wholly at the centre, and past which it is not there at all. */
export const THREAT_CENTRE_DEG = 6;
export const THREAT_WIDE_DEG = 25;
/** Metres from the eye within which a thing counts whole, and past which it counts for nothing. */
export const THREAT_NEAR_M = 6;
export const THREAT_FAR_M = 30;

const COS_WIDE = Math.cos((THREAT_WIDE_DEG * Math.PI) / 180);
const clamp01 = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t);

/**
 * How much the thing at (`x`, `z`) presses on an eye at `eye` looking along
 * its yaw, over the ground: whole close and dead ahead, falling evenly with
 * its distance and with the angle it stands off the look, and scaled by how
 * much of it is `there` (a figure still rising counts for less).
 */
export function threatOf(eye: { x: number; z: number; yaw: number }, x: number, z: number, there = 1): number {
  const dx = x - eye.x, dz = z - eye.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d <= 0 || d >= THREAT_FAR_M) return 0;
  const cos = (dx * Math.sin(eye.yaw) + dz * Math.cos(eye.yaw)) / d;
  if (cos <= COS_WIDE) return 0;
  // By the angle itself, so the fall is even across the cone.
  const off = (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
  const centred = 1 - clamp01((off - THREAT_CENTRE_DEG) / (THREAT_WIDE_DEG - THREAT_CENTRE_DEG));
  const near = 1 - clamp01((d - THREAT_NEAR_M) / (THREAT_FAR_M - THREAT_NEAR_M));
  return centred * near * clamp01(there);
}
