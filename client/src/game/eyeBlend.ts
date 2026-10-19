/**
 * The local eye between two ticks.
 *
 * The simulation steps at `SIM_TICK_HZ` and the renderer draws whenever the
 * browser asks, so a frame falls somewhere inside a tick: the accumulator's
 * `alpha` (`loop.ts`) says how far. Drawing the eye where the last tick left
 * it moves it by one tick on some frames and two on others whenever the frame
 * rate is not the tick rate, which the player feels as a judder in the walk
 * and a stutter in the look. Drawing it `alpha` of the way from where the
 * last tick began to where it ended moves it the frame's own share of the
 * tick instead, one tick behind the simulation, which nothing a player does
 * can tell.
 *
 * Pure, so the blend is tested under Node; the renderer applies it to the
 * camera (`renderer.ts`), and the loops capture the pose before their last
 * tick (`app.ts`).
 */
import type { PlayerState } from "../sim/types.js";

/** A pose of the eye: the hull's centre and the look, as the sim holds them. */
export type EyePose = { x: number; y: number; z: number; yaw: number; pitch: number };

/**
 * Past this far (m) between the two poses the blend snaps to the newer one:
 * no tick moves a player this far, so the two straddle a teleport (a stand
 * at a place, a respawn), which a sweep through the ground would misdraw.
 */
export const EYE_SNAP_M = 3;

export function capturedEye(player: Pick<PlayerState, "pos" | "yaw" | "pitch">, out: EyePose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }): EyePose {
  out.x = player.pos.x;
  out.y = player.pos.y;
  out.z = player.pos.z;
  out.yaw = player.yaw;
  out.pitch = player.pitch;
  return out;
}

/** The angle `b` reached from `a` by the shorter way round, as an offset from `a` in (-π, π]. */
function turn(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Fills `out` with the eye `alpha` of the way from `before` to the player's
 * pose now; the player's own pose where there is no `before`, where `alpha`
 * is at or past 1, or where the two are a teleport apart. The yaw turns the
 * shorter way round.
 */
export function blendedEye(
  before: EyePose | null,
  player: Pick<PlayerState, "pos" | "yaw" | "pitch">,
  alpha: number,
  out: EyePose,
): EyePose {
  if (before === null || !(alpha < 1)) return capturedEye(player, out);
  const t = alpha < 0 ? 0 : alpha;
  const dx = player.pos.x - before.x;
  const dy = player.pos.y - before.y;
  const dz = player.pos.z - before.z;
  if (dx * dx + dy * dy + dz * dz > EYE_SNAP_M * EYE_SNAP_M) return capturedEye(player, out);
  out.x = before.x + dx * t;
  out.y = before.y + dy * t;
  out.z = before.z + dz * t;
  out.yaw = before.yaw + turn(before.yaw, player.yaw) * t;
  out.pitch = before.pitch + (player.pitch - before.pitch) * t;
  return out;
}
