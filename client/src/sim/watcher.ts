/**
 * The watcher (docs/gameplay/2026-09-16-the-summit.md §4): the one Hollow of
 * the climb. It stands off the trail at the edge of sight, facing the lead,
 * closer with every showing as the party climbs; it never walks and never
 * touches, and it is gone the moment nobody has it in view or someone comes
 * near. The stare fills while you look at it, so the climb's danger is your
 * own curiosity. It is removed for good when the body is found; the summit
 * Hollow is a separate spawn.
 *
 * Host only, off the wire and outside the fingerprint, like the cut: the
 * record here (whether it is shown, the rest until it shows again, its own
 * random stream) lives on `World`, and peers receive the watcher as an enemy
 * in the snapshot they already get, drawn as the Hollow shape. The rules are
 * three — who the lead is, where the watcher may stand, and (in the tick)
 * when it hides — and the placement is pure but for the draws it spends.
 *
 * The watcher draws from its own stream, `worldSeed ^ WATCH_SALT`, not the
 * world's. Nothing on a climb draws from the world RNG today, and the guide
 * is drawn from it on the discovery tick: a watcher that shared the stream
 * would move the guide by however many ticks the climb took.
 *
 * sim/ determinism rules: no trig (the bearing is a rotation by constant
 * cosines and sines), no Math.pow, no `**`, no hypot; `Math.sqrt` only.
 */
import type { EnemyState, PlayerState, Vec3 } from "./types.js";
import { AiState, cloneVec3, nextRandom } from "./types.js";
import type { World } from "./world.js";
import type { TrailGraph, TrailNode } from "./trail.js";
import { trailDistance } from "./trail.js";
import { stemProgress } from "./trailRoute.js";
import { groundSpawn } from "./spawn.js";
import { hasLineOfSight } from "./ai.js";
import { aimDirection } from "./view.js";
import { isOnCorridor } from "./containment.js";
import { horizontalDistSq } from "./hollow.js";
import { ENEMY_HALF, ENEMY_MAX_HEALTH, PLAYER_EYE_OFFSET } from "./constants.js";

/** Metres it keeps from every trail centreline: 6 stands just inside the 7 m cleared strip. */
export const WATCH_TRAIL_CLEAR = 6;
/** Metres from the lead at reach 0, the pad. */
export const WATCH_RANGE_FAR = 90;
/** Metres from the lead at reach 1, the top fork. */
export const WATCH_RANGE_NEAR = 25;
/**
 * The bearing band off the lead's horizontal look, 30° to 70°, as the
 * cosines and sines of its two edges: the band is drawn by rotating the look
 * direction, so no angle is ever taken. The rounded constants make the 30°
 * edge's length 0.99998, which is why a test bounds the cosine at 0.8661.
 */
export const WATCH_BEARING_MIN_COS = 0.866;
export const WATCH_BEARING_MIN_SIN = 0.5;
export const WATCH_BEARING_MAX_COS = 0.342;
export const WATCH_BEARING_MAX_SIN = 0.9397;
/** Horizontal metres from any living player within which it will not stand, and hides. */
export const WATCH_FLEE_RADIUS = 15;
/** Placements tried per tick once the rest is up. */
export const WATCH_PLACE_TRIES = 8;
/** The rest between showings at the pad, seconds. */
export const WATCH_REST_MIN = 20;
export const WATCH_REST_MAX = 60;
/** What the rest scales down to at the top fork: sightings get frequent near the top. */
export const WATCH_REST_NEAR_SCALE = 0.4;
/**
 * cos 80°: the wide cone that keeps it shown. The stare's 20° cone cannot be
 * the test, because it is placed 30°–70° off the look and would hide on its
 * first tick; the camera's field of view is about 112° across at a wide
 * screen, so 80° a side is what a player can actually see.
 */
export const WATCH_VIEW_COS = 0.1736;
/** The least ground-normal y it stands on: the 0.9 gradient the trail treats as hard. */
export const WATCH_SLOPE_NY = 0.74;
/** Mixed into the world seed for the watcher's own stream. */
export const WATCH_SALT = 0x57a7c4;

/** Host-only. Off the wire, outside the fingerprint (`World.watcher`, world.ts). */
export type WatcherRecord = {
  /** The entity id while shown, or -1. */
  id: number;
  /** Seconds until the next showing while hidden. */
  rest: number;
  /** The watcher's own random stream, seeded from the world's seed. */
  rng: { rngSeed: number };
};

/** A rest from the band, unscaled: the pad's. */
function drawRest(rng: { rngSeed: number }): number {
  return WATCH_REST_MIN + nextRandom(rng) * (WATCH_REST_MAX - WATCH_REST_MIN);
}

/**
 * The record with its stream seeded and its first rest drawn from the band,
 * so the watcher does not show on tick one.
 */
export function createWatcherRecord(seed: number): WatcherRecord {
  const rng = { rngSeed: (seed ^ WATCH_SALT) | 0 };
  return { id: -1, rest: drawRest(rng), rng };
}

/** How far up the stem a point is: 1 − stemProgress, 0 at the pad, 1 at the crest. */
export function climbOf(graph: TrailGraph, x: number, z: number): number {
  return 1 - stemProgress(graph, x, z);
}

/** The living player farthest up the stem by climb, ties to the lower id; null when none lives. */
export function leadOf(world: World): PlayerState | null {
  const graph = world.trail;
  if (graph === null) return null;
  let best: PlayerState | null = null;
  let bestClimb = -Infinity;
  for (const p of world.state.players.values()) {
    if (p.health <= 0) continue;
    const climb = climbOf(graph, p.pos.x, p.pos.z);
    if (climb > bestClimb || (climb === bestClimb && best !== null && p.id < best.id)) {
      bestClimb = climb;
      best = p;
    }
  }
  return best;
}

/** The greatest climb over the graph's forks, or 1 when it has none. */
export function topForkClimb(graph: TrailGraph): number {
  if (graph.forks.length === 0) return 1;
  let top = -Infinity;
  for (let i = 0; i < graph.forks.length; i++) {
    const n = graph.nodes[graph.forks[i] as number] as TrailNode;
    const climb = climbOf(graph, n.x, n.z);
    if (climb > top) top = climb;
  }
  return top;
}

/**
 * The lead's climb over the top fork's, clamped to [0, 1]: 0 at the pad, 1
 * from the top fork on up. A top fork at the pad itself has no climb to
 * measure against, and the reach is 1.
 */
export function reachOf(world: World, lead: PlayerState): number {
  const graph = world.trail;
  if (graph === null) return 0;
  const top = topForkClimb(graph);
  const reach = top > 0 ? climbOf(graph, lead.pos.x, lead.pos.z) / top : 1;
  return reach < 0 ? 0 : reach > 1 ? 1 : reach;
}

/**
 * One placement attempt from the record's stream: a point at the reach's
 * range from the lead, on a drawn side, in the bearing band off the lead's
 * horizontal look; null unless it is at least WATCH_TRAIL_CLEAR from every
 * trail centreline, standable (`groundSpawn` with ENEMY_HALF, ground normal
 * y ≥ WATCH_SLOPE_NY), off the road corridor, at least WATCH_FLEE_RADIUS from
 * every living player, and in a clear sightline from the lead's eye to the
 * watcher's centre. Null at once on a world without forest, ground, trail or
 * record. Otherwise it always spends its two draws, landed or not, so the
 * stream advances the same way whatever the ground says.
 *
 * The bearing is drawn without an angle. With the look `l` on the XZ plane,
 * `R(l, c, s, side) = (l.x·c − side·l.z·s, side·l.x·s + l.z·c)` is `l`
 * turned by the angle whose cosine and sine are `c, s`, to the lead's left
 * for side +1. The two band edges are 40° apart, so every mix of them is a
 * chord of the minor arc, never zero, and normalising it lands inside the
 * band for every draw. Not uniform in angle, which nothing needs.
 */
export function placeWatcher(world: World, lead: PlayerState, reach: number): Vec3 | null {
  const record = world.watcher;
  const graph = world.trail;
  if (record === null || graph === null || world.forest === null || world.ground === null) return null;

  const side = nextRandom(record.rng) < 0.5 ? -1 : 1;
  const mix = nextRandom(record.rng);
  const look = aimDirection(lead.yaw, 0);
  const minX = look.x * WATCH_BEARING_MIN_COS - side * look.z * WATCH_BEARING_MIN_SIN;
  const minZ = side * look.x * WATCH_BEARING_MIN_SIN + look.z * WATCH_BEARING_MIN_COS;
  const maxX = look.x * WATCH_BEARING_MAX_COS - side * look.z * WATCH_BEARING_MAX_SIN;
  const maxZ = side * look.x * WATCH_BEARING_MAX_SIN + look.z * WATCH_BEARING_MAX_COS;
  let bx = (1 - mix) * minX + mix * maxX;
  let bz = (1 - mix) * minZ + mix * maxZ;
  const len = Math.sqrt(bx * bx + bz * bz);
  bx /= len;
  bz /= len;
  const range = WATCH_RANGE_FAR + (WATCH_RANGE_NEAR - WATCH_RANGE_FAR) * reach;
  const x = lead.pos.x + bx * range;
  const z = lead.pos.z + bz * range;

  if (trailDistance(graph, x, z) < WATCH_TRAIL_CLEAR) return null;
  const centre = groundSpawn(world.boxes, world.forest.seed, x, z, ENEMY_HALF);
  if (centre === null) return null;
  const normal: Vec3 = { x: 0, y: 0, z: 0 };
  world.ground.normalAt(x, z, normal);
  if (normal.y < WATCH_SLOPE_NY) return null;
  if (isOnCorridor(world, x, z)) return null;
  for (const p of world.state.players.values()) {
    if (p.health > 0 && horizontalDistSq(p.pos, centre) < WATCH_FLEE_RADIUS * WATCH_FLEE_RADIUS) return null;
  }
  const eye: Vec3 = { x: lead.pos.x, y: lead.pos.y + PLAYER_EYE_OFFSET, z: lead.pos.z };
  if (!hasLineOfSight(eye, centre, world.boxes, world.ground)) return null;
  return centre;
}

/**
 * Spawns the watcher at `at`, facing `leadId`, and records its id. Its yaw
 * starts at 0 and `stepHollow`'s Watch case turns it to the lead the same
 * tick.
 */
export function spawnWatcher(world: World, at: Vec3, leadId: number): EnemyState {
  const watcher: EnemyState = {
    id: world.state.nextEntityId++,
    pos: cloneVec3(at),
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    health: ENEMY_MAX_HEALTH,
    ai: AiState.Watch,
    targetId: leadId,
    stateTimer: 0,
    attackCooldown: 0,
    lastDistSq: Infinity,
    stuckTimer: 0,
    unstickTimer: 0,
    route: [],
    routeAt: 0,
    approach: false,
    seen: false,
    emergeTo: null,
  };
  world.state.enemies.set(watcher.id, watcher);
  if (world.watcher !== null) world.watcher.id = watcher.id;
  return watcher;
}

/** Removes the watcher entity, if shown, and clears the id. */
export function hideWatcher(world: World): void {
  const record = world.watcher;
  if (record === null) return;
  if (record.id !== -1) world.state.enemies.delete(record.id);
  record.id = -1;
}
