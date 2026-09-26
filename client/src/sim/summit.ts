/**
 * The summit (docs/gameplay/2026-09-16-the-summit.md §2, §5.1, §5.2): the
 * match's two acts and the rules that turn one into the other. Every tick,
 * host only: who is on the road corridor (safe ground), whether the first
 * living player has found the body (the phase flips for everyone and the
 * summit Hollow steps out), which forks the descending party has reached
 * and so cut (cut.ts), and whether the match is over (no living player
 * still out). The first of those runs before the Hollows move and the
 * others after them — see each function.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
import type { PlayerState, Vec3 } from "./types.js";
import { Outcome, Phase } from "./types.js";
import type { World } from "./world.js";
import { isOnCorridor } from "./containment.js";
import { SUMMIT_REVEAL_S, spawnHollow } from "./hollow.js";
import { drawGuide, stepCuts } from "./cut.js";
import { hideWatcher } from "./watcher.js";
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
function emergePoint(world: World, body: Vec3, finderPos: Vec3): Vec3 {
  let dx = body.x - finderPos.x, dz = body.z - finderPos.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len > 1e-9) { dx /= len; dz /= len; } else { dx = 1; dz = 0; }
  const x = body.x + dx * SUMMIT_SPAWN_DIST, z = body.z + dz * SUMMIT_SPAWN_DIST;
  const groundY = world.ground !== null ? world.ground.heightAt(x, z) : body.y;
  return { x, y: groundY + ENEMY_HALF.y, z };
}

/**
 * Safe ground, from this tick's positions. Host only, and called at the HEAD
 * of the tick's authoritative tail, before the Hollows move: players move at
 * the top of the tick, so a `safe` left over from the previous tick would have
 * a player who crossed the treeline this tick still reading as prey — and a
 * Hollow standing at the corridor's edge is within contact reach of someone
 * a hand's breadth inside it. Contact kills, and death is permanent, so that
 * one stale tick is a player killed on safe ground.
 */
export function updateSafety(world: World): void {
  // Only a world with a road has safe ground to stand on. A hand-authored
  // level has neither, so nothing here writes its players' `safe`: on those
  // worlds the flag stays whatever put it there, which is false unless a
  // sandbox scenario sets it to exercise the Hollow's rules.
  if (world.forest === null) return;
  for (const p of world.state.players.values()) p.safe = isOnCorridor(world, p.pos.x, p.pos.z);
}

/**
 * The find, the cut and the end, host only, at the TAIL of the tick: all
 * three are judged on everything the tick has already settled, the deaths
 * included. Safety is not here — it is `updateSafety` above, which the same
 * tick already ran.
 *
 * The tick that finds the body removes the climb's watcher for good
 * (watcher.ts), steps the summit Hollow out and draws the guide (cut.ts), the
 * one draw the chase makes from the world's stream; every Chase tick after it
 * runs the cut, then the end rule. A player on the corridor is safe and
 * triggers nothing, so once the end rule can fire there is nothing left for
 * the cut to do: its Hollows only ever step out into a match still on.
 */
export function stepSummit(world: World): void {
  const register = world.register;
  const state = world.state;
  if (register === null || world.trail === null) return;
  // A finished match finds nothing and ends nothing. The guard covers the
  // climb as well as the chase: a forest party that died on the way up is
  // already Lost (`updateLoss`), and a player joining that match must not be
  // able to walk to the body and step a Hollow out into it.
  if (state.outcome !== Outcome.Playing) return;

  if (state.phase === Phase.Climb) {
    const who = finder(world, register.body.pos);
    if (who === null) return;
    state.phase = Phase.Chase;
    // The watcher first: deleting an enemy here is safe because the deaths
    // and the loss were judged above, and the snapshot is built after the
    // tick. The summit Hollow is a separate spawn, never the watcher kept.
    hideWatcher(world);
    spawnHollow(world, emergePoint(world, register.body.pos, who.pos), who.id, SUMMIT_REVEAL_S);
    world.cut = drawGuide(world);
    return;
  }

  stepCuts(world);
  let out = 0, safe = 0;
  for (const p of state.players.values()) {
    if (dead(p)) continue;
    if (p.safe) safe++;
    else out++;
  }
  if (out > 0) return;
  state.outcome = safe > 0 ? Outcome.Won : Outcome.Lost;
}
