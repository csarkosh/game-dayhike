/**
 * Coming back (checkpoint.ts has the rules; this is the step). Host only,
 * in the tick's tail after the deaths are settled: each player who died in
 * the chase is counted down and, at nothing, stood on the crest again where
 * the party stood at the find, alive, held for the threshold's seconds.
 *
 * One Hollow meets them, stepping out past the body and already walking at
 * them. It is an existing one moved there whenever that can go unseen: the
 * one that killed them if a Hollow did, else the one nearest where they
 * fell, and only if no other living player has it in view. Seen, it stays
 * and a new one rises, unless the pack is at its cap, where the unseen one
 * farthest from the other players is taken. And every other Hollow with no
 * living player to hunt is withdrawn, the fork it closed whole again: a
 * player alone starts the chase over with the same hidden way down, never
 * running through what their last attempt left standing on it. (A fork's
 * Hollow that is moved, not withdrawn, leaves its fork cut while others are
 * alive, so the pack does not grow by a Hollow a death.)
 */
import type { EnemyState, PlayerState, Vec3 } from "./types.js";
import { AiState } from "./types.js";
import type { World } from "./world.js";
import { ENEMY_HALF, PLAYER_HALF, PLAYER_MAX_HEALTH, SIM_TICK_HZ } from "./constants.js";
import { HOLLOW_PACK_MAX, RETURN_AFTER_S, RETURN_HEAD_START_M, RETURN_HOLD_S, returnsOn } from "./checkpoint.js";
import { clearRoute, horizontalDistSq, playerHasInView, spawnHollow } from "./hollow.js";
import { WATCH_VIEW_COS } from "./watcher.js";
import { emergePoint, fileSpot } from "./summit.js";

/** A Hollow of the pack: one that hunts, steps out or stands, not a shade, a lunge or the watcher. */
function inPack(e: EnemyState): boolean {
  return e.ai === AiState.Hunt || e.ai === AiState.Emerge || e.ai === AiState.Stand;
}

/**
 * Whether a living player other than `but` has `h` anywhere in their frame:
 * the wide cone the watcher is judged by (watcher.ts `WATCH_VIEW_COS`, a
 * frame about 112° across), not the stare's narrow one, since a Hollow that
 * vanishes at the edge of a screen has still vanished before their eyes.
 */
function seenByOthers(world: World, h: EnemyState, but: PlayerState): boolean {
  for (const q of world.state.players.values()) {
    if (q.id === but.id || q.health <= 0) continue;
    if (playerHasInView(q, h, world, WATCH_VIEW_COS)) return true;
  }
  return false;
}

/** Whether a living player other than `but` is in the match. */
function othersAlive(world: World, but: PlayerState): boolean {
  for (const q of world.state.players.values()) if (q.id !== but.id && q.health > 0) return true;
  return false;
}

/** The square of the metres from `h` to the nearest living player other than `but`; Infinity when there is none. */
function nearestOtherSq(world: World, h: EnemyState, but: PlayerState): number {
  let best = Infinity;
  for (const q of world.state.players.values()) {
    if (q.id === but.id || q.health <= 0) continue;
    best = Math.min(best, horizontalDistSq(q.pos, h.pos));
  }
  return best;
}

/** Where on the crest `p` returns: the find's place, or the first step down the stem from it that no other living player is standing on. */
function returnSpot(world: World, p: PlayerState, crest: { pos: Vec3 }): { x: number; z: number } {
  for (let k = 0; k < 8; k++) {
    const at = k === 0 ? { x: crest.pos.x, z: crest.pos.z } : fileSpot(world, crest.pos, k - 1);
    let taken = false;
    for (const q of world.state.players.values()) {
      if (q.id !== p.id && q.health > 0 && horizontalDistSq(q.pos, at) < 1) taken = true;
    }
    if (!taken) return at;
  }
  return { x: crest.pos.x, z: crest.pos.z };
}

/** The fork `h` closed is whole again, to be cut afresh when a player next reaches it. */
function reopenFork(world: World, h: EnemyState): void {
  if (h.fork < 0 || world.cut === null) return;
  world.cut.cuts.delete(h.fork);
  world.cut.closed.delete(h.forkEdge);
  h.fork = -1;
  h.forkEdge = -1;
}

/** The Hollow that meets `p`: an existing one where the rules allow, else a new one. */
function hollowFor(world: World, p: PlayerState, fell: Vec3): EnemyState | null {
  const pack = [...world.state.enemies.values()].filter(inPack);
  const killer = world.state.enemies.get(p.killedBy);
  let first: EnemyState | null = killer !== undefined && inPack(killer) ? killer : null;
  if (first === null) {
    // Nearest where they fell, ties to the lower id (the pack is in id order).
    let bestSq = Infinity;
    for (const h of pack) {
      const sq = horizontalDistSq(h.pos, fell);
      if (sq < bestSq) { bestSq = sq; first = h; }
    }
  }
  if (first !== null && !seenByOthers(world, first, p)) return first;
  if (pack.length < HOLLOW_PACK_MAX) return null;
  // At the cap: the one farthest from every other living player, an unseen one before a seen.
  let best: EnemyState | null = null;
  let bestUnseen = false;
  let bestSq = -1;
  for (const h of pack) {
    const unseen = !seenByOthers(world, h, p);
    const sq = nearestOtherSq(world, h, p);
    if (best === null || (unseen && !bestUnseen) || (unseen === bestUnseen && sq > bestSq)) {
      best = h; bestUnseen = unseen; bestSq = sq;
    }
  }
  return best;
}

/**
 * Where the Hollow that meets a returning player steps out, from where that
 * player stands on the crest: past the body on the line from them through
 * it, as the summit's stepped out, and `RETURN_HEAD_START_M` into its walk
 * at them. From the world's own ground and body alone, so every peer works
 * out the same place: a follower's screen aims its camera here on the frame
 * its player is back, before any snapshot has shown the Hollow there. Null
 * on a world with no summit.
 */
export function returnHollowAt(world: World, player: { x: number; z: number }): Vec3 | null {
  const search = world.search;
  if (search === null) return null;
  const out = emergePoint(world, search.body.pos, { x: player.x, y: 0, z: player.z });
  let dx = player.x - out.x, dz = player.z - out.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len > 1e-9) { dx /= len; dz /= len; } else { dx = 0; dz = 0; }
  const x = out.x + dx * RETURN_HEAD_START_M, z = out.z + dz * RETURN_HEAD_START_M;
  const y = (world.ground?.heightAt(x, z) ?? out.y - ENEMY_HALF.y) + ENEMY_HALF.y;
  return { x, y, z };
}

/** Brings `p` back: stood on the crest, their Hollow stepping out, the idle ones withdrawn. */
function returnPlayer(world: World, p: PlayerState): void {
  const search = world.search;
  if (search === null) return;
  const crest = world.crest ?? { pos: search.body.pos, yaw: p.yaw };
  const fell = p.deathPos ?? p.pos;
  const chosen = hollowFor(world, p, fell);

  const at = returnSpot(world, p, crest);
  const ground = world.ground?.heightAt(at.x, at.z) ?? crest.pos.y - PLAYER_HALF.y;
  p.pos = { x: at.x, y: ground + PLAYER_HALF.y, z: at.z };
  p.vel = { x: 0, y: 0, z: 0 };
  p.yaw = crest.yaw;
  p.health = PLAYER_MAX_HEALTH;
  p.deathPos = null;
  p.stare = 0;
  p.killedBy = 0;
  p.returnIn = 0;
  p.heldFor = RETURN_HOLD_S * SIM_TICK_HZ;

  const { x, y, z } = returnHollowAt(world, p.pos) ?? p.pos;
  const h = chosen ?? spawnHollow(world, { x, y, z }, p.id, RETURN_HOLD_S);
  // A fork's Hollow moved stays in the pack. Alone, its fork is made whole, to be cut afresh as the
  // player comes down again; with others alive it stays cut, or every death at that fork would
  // raise one more Hollow there, each of which turns on the survivors the next time.
  if (!othersAlive(world, p)) reopenFork(world, h);
  h.pos = { x, y, z };
  h.vel = { x: 0, y: 0, z: 0 };
  clearRoute(h);
  h.ai = AiState.Emerge;
  h.emergeTo = null;
  h.stateTimer = RETURN_HOLD_S;
  h.targetId = p.id;
  h.stalks = true;
  h.stuckTimer = 0;
  h.unstickTimer = 0;
  h.lastDistSq = Infinity;

  // The rest with nobody to hunt: standing, or still turned to this player or to one who is dead or gone.
  for (const [id, e] of world.state.enemies) {
    if (e === h || !inPack(e)) continue;
    const target = world.state.players.get(e.targetId);
    const idle = e.ai === AiState.Stand || e.targetId === p.id || target === undefined || target.health <= 0;
    if (!idle) continue;
    reopenFork(world, e);
    world.state.enemies.delete(id);
  }
}

/**
 * The returns, host only, in the tick's tail after `updateDeaths` and before
 * the loss and the end are judged: a player dead in the chase is counted
 * down from the tick they fell and brought back; every hold is counted
 * down. Nothing happens where a death does not come back (`returnsOn`).
 */
export function stepReturns(world: World): void {
  for (const p of world.state.players.values()) if (p.heldFor > 0) p.heldFor--;
  if (!returnsOn(world)) return;
  for (const p of world.state.players.values()) {
    if (p.health > 0) continue;
    if (p.returnIn <= 0) {
      p.returnIn = RETURN_AFTER_S * SIM_TICK_HZ;
      continue;
    }
    p.returnIn--;
    if (p.returnIn <= 0) returnPlayer(world, p);
  }
}

