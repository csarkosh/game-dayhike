/**
 * Why a player died in the chase (docs/gameplay/2026-09-16-the-summit.md §2):
 * what they were doing as the thing reached them, read by the host at the
 * kill. It rides the snapshot in the flags byte, and the player's own screen
 * says a line by it when they come back (game/innerLines.ts).
 *
 * One cause a death, the first of these that applies: off the trail; standing
 * still, or slower than a walk; moving toward what killed them; watching it
 * (the stare most of the way closed); taken by a shade's lunge; and, none of
 * those, run down from behind.
 */
import type { EnemyState, PlayerState } from "./types.js";
import { AiState, DeathCause } from "./types.js";
import type { World } from "./world.js";
import { trailDistance } from "./trail.js";

/** Metres from the trail past which a player is off it: the haunt's own measure (`OFF_TRAIL_FROM_M`, haunt.ts; a test holds the two equal). */
export const OFF_TRAIL_M = 4;
/** Ground speed, m/s, under which a player is standing still: slower than a walk. */
export const STILL_SPEED = 1.5;
/** How nearly at the killer a player must be moving to have gone toward it: the cosine between their ground velocity and the line to it. */
export const INTO_COS = 0.3;
/** The stare at and over which a player was watching it. */
export const LOOKED_STARE = 0.6;

/**
 * Why `p` dies to `killer` this tick, by its touch (`contact`) or a lunge's
 * blow (`strike`). Read before the death is made: the player's velocity is
 * zeroed with it.
 */
export function causeOfDeath(world: World, p: PlayerState, killer: EnemyState, by: "contact" | "strike"): DeathCause {
  if (world.trail !== null && trailDistance(world.trail, p.pos.x, p.pos.z) > OFF_TRAIL_M) return DeathCause.OffTrail;
  const speed = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);
  if (speed < STILL_SPEED) return DeathCause.Still;
  const dx = killer.pos.x - p.pos.x, dz = killer.pos.z - p.pos.z;
  const away = Math.sqrt(dx * dx + dz * dz);
  if (away > 1e-9 && (p.vel.x * dx + p.vel.z * dz) / (speed * away) >= INTO_COS) return DeathCause.Into;
  if (p.stare >= LOOKED_STARE) return DeathCause.Looked;
  if (by === "strike" || killer.ai === AiState.Lunge || killer.ai === AiState.Strike) return DeathCause.Lunge;
  return DeathCause.Caught;
}
