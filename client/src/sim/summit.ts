/**
 * The summit (docs/gameplay/2026-09-16-the-summit.md §2, §5.1, §5.2): the
 * match's two acts and the rules that turn one into the other. Every tick,
 * host only, after the Hollows have moved: who is on the road corridor (safe
 * ground), whether the first living player has found the body (the phase
 * flips for everyone and the summit Hollow steps out), and whether the match
 * is over (no living player still out).
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
import type { PlayerState, Vec3 } from "./types.js";
import { Outcome, Phase } from "./types.js";
import type { World } from "./world.js";
import { isOnCorridor } from "./containment.js";
import { SUMMIT_REVEAL_S, spawnHollow } from "./hollow.js";
import { ENEMY_HALF } from "./constants.js";

/** Metres from the body within which a living player has found it: inside the 25 m crest disc. */
export const DISCOVERY_RADIUS = 12;
/** Metres behind the body, on the far side from the finder, where the Hollow steps out. */
export const SUMMIT_SPAWN_DIST = 6;

function dead(p: PlayerState): boolean {
  return p.health <= 0;
}

/** The living player within DISCOVERY_RADIUS of the body, lowest id first; null when none. */
function finder(world: World, body: Vec3): PlayerState | null {
  let best: PlayerState | null = null;
  for (const p of world.state.players.values()) {
    if (dead(p)) continue;
    const dx = p.pos.x - body.x, dz = p.pos.z - body.z;
    if (dx * dx + dz * dz > DISCOVERY_RADIUS * DISCOVERY_RADIUS) continue;
    if (best === null || p.id < best.id) best = p;
  }
  return best;
}

/** Where the Hollow steps out: SUMMIT_SPAWN_DIST past the body along the line from the finder through it. */
function emergePoint(world: World, body: Vec3, finder: PlayerState): Vec3 {
  let dx = body.x - finder.pos.x, dz = body.z - finder.pos.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len > 1e-9) { dx /= len; dz /= len; } else { dx = 1; dz = 0; }
  const x = body.x + dx * SUMMIT_SPAWN_DIST, z = body.z + dz * SUMMIT_SPAWN_DIST;
  const groundY = world.ground !== null ? world.ground.heightAt(x, z) : body.y;
  return { x, y: groundY + ENEMY_HALF.y, z };
}

export function stepSummit(world: World): void {
  const register = world.register;
  const state = world.state;
  if (register === null || world.trail === null) return;

  // Safety is a state of the ground, read fresh every tick.
  for (const p of state.players.values()) p.safe = isOnCorridor(world, p.pos.x, p.pos.z);

  if (state.phase === Phase.Climb) {
    const who = finder(world, register.body.pos);
    if (who === null) return;
    state.phase = Phase.Chase;
    spawnHollow(world, emergePoint(world, register.body.pos, who), who.id, SUMMIT_REVEAL_S);
    return;
  }

  if (state.outcome !== Outcome.Playing) return;
  let out = 0, safe = 0;
  for (const p of state.players.values()) {
    if (dead(p)) continue;
    if (p.safe) safe++;
    else out++;
  }
  if (out > 0) return;
  state.outcome = safe > 0 ? Outcome.Won : Outcome.Lost;
}
