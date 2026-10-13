/**
 * The haunt (docs/gameplay/2026-10-06-the-haunt.md): the night's shadow
 * figures. A director on the host runs episodes once the night is in, and
 * through the chase: for a dozen or twenty seconds, every few seconds, a
 * shade stands up somewhere at the edge of a player's sight and walks at
 * and stands and stares at them, and is gone again when they come near,
 * when they look at it too long, or when its time is up. Most are nothing. One in an episode,
 * sometimes, is a lunge: it comes fast and straight, bending only a little
 * toward its player, and at arm's length it strikes, which kills within its
 * reach; a player who steps out of its line sees it pass and dissolve. The
 * haunt begins once the mist is whole on the ground, lightly, and presses
 * harder the nearer the party is to the crest. In the chase a shade stands where the open way home
 * runs, beside the path: the thing that hunts the party also shows them the
 * way. And when the match is won, the woods come after the party: the
 * pursuit (`startPursuit`) stands shades up at the trail's entrance that walk
 * to the car's door and stand at the road (docs/gameplay/2026-10-12-the-end-scene.md §2).
 *
 * Host only, off the wire and outside the fingerprint, like the watcher's
 * record; the shades themselves are enemies in the snapshot, drawn as the
 * Hollow with the shadow's look (game/entityViews.ts). The lens and the
 * whispers each screen adds are its own (game/escalation.ts). Draws come
 * from the haunt's own stream, `worldSeed ^ HAUNT_SALT`.
 *
 * sim/ determinism rules: no trig (the bearing is the watcher's rotation
 * by constant cosines and sines), no Math.pow, no hypot; `Math.sqrt` only.
 * `Math.atan2` for a facing is allowed here as in hollow.ts: host-only.
 */
import type { EnemyState, PlayerState, Vec3 } from "./types.js";
import { AiState, Outcome, Phase, cloneVec3, nextRandom } from "./types.js";
import type { World } from "./world.js";
import type { TrailNode } from "./trail.js";
import { nearestTrailNode } from "./trail.js";
import { groundSpawn } from "./spawn.js";
import { hasLineOfSight } from "./ai.js";
import { aimDirection } from "./view.js";
import { isOnCorridor, roadOffset, ROAD_WALL_U } from "./containment.js";
import { carDirection, doorSpot, trailEntrance } from "./trailhead.js";
import { faceToward, horizontalDistSq, playerSees, revealing, walkToward } from "./hollow.js";
import { climbOf, WATCH_SLOPE_NY, WATCH_VIEW_COS } from "./watcher.js";
import { actsUnder, MIST_AT, MIST_SPAN, smootherstep } from "./acts.js";
import { trailDistance } from "./trail.js";
import { ENEMY_HALF, ENEMY_MAX_HEALTH, PLAYER_EYE_OFFSET } from "./constants.js";

/** The mist below which the climb is not haunted: the mist whole on the ground, so the shades have it to come out of. */
export const HAUNT_MIST_MIN = 0.95;
/**
 * The haunt's pressure, 0 as the mist comes whole and 1 from
 * HAUNT_PRESS_SPAN of the climb after that, by smootherstep, so the night
 * is at its full pressure well before the crest (and throughout the chase):
 * the rests between episodes run from the early band to the late, and an
 * episode's shades from the fewest to the most.
 */
export const HAUNT_PRESS_SPAN = 0.45;
export const HAUNT_REST_EARLY: readonly [number, number] = [60, 110];
export const HAUNT_REST_LATE: readonly [number, number] = [14, 30];
export const HAUNT_REST_CHASE: readonly [number, number] = [0, 2];
export const HAUNT_SHADES_EARLY: readonly [number, number] = [1, 2];
export const HAUNT_SHADES_LATE: readonly [number, number] = [6, 10];
/** An episode's length, and the seconds between its shades. */
export const HAUNT_EPISODE_S: readonly [number, number] = [18, 30];
export const HAUNT_SHADE_GAP_S: readonly [number, number] = [0.9, 2.2];
/** The chance an episode's last shade is a lunge, on the climb and in the chase. */
export const HAUNT_REAL_CLIMB = 0.55;
export const HAUNT_REAL_CHASE = 0.9;
/**
 * Metres from its player a shade stands, how long it stands, how near a
 * player may come, and how long it may be looked at. Close, and inside the
 * headlamp: at night an unlit figure is black on black, and the first
 * showings, 12 to 28 m out and 30° to 70° off the look, were never seen.
 */
export const SHADE_RANGE: readonly [number, number] = [7, 40];
export const SHADE_DWELL_S: readonly [number, number] = [8, 18];
export const SHADE_FLEE_RADIUS = 5;
/** Metres a new shade keeps from every shade standing: no two in one spot. */
export const SHADE_APART_M = 4;
export const SHADE_WATCHED_S = 2.5;
/**
 * The chase, off the trail: from OFF_TRAIL_FROM_M off it, over OFF_TRAIL_SPAN_M,
 * an episode has up to OFF_TRAIL_SHADES_GAIN times more shades, that much
 * closer together, and each shade is a lunge with a chance rising from
 * OFF_TRAIL_REAL_EACH to 1. The trail is
 * the way home; leaving it is answered.
 */
export const OFF_TRAIL_FROM_M = 4;
export const OFF_TRAIL_SPAN_M = 16;
export const OFF_TRAIL_SHADES_GAIN = 2;
export const OFF_TRAIL_REAL_EACH = 0.1;
/**
 * The bearing band off the player's look a shade or a lunge stands in, 16°
 * to 40°, as the cosines and sines of its two edges (the watcher's method,
 * watcher.ts): in the player's view and in the mist at their side
 * (game/hauntMist.ts), and just outside the stare's 20° at its near edge,
 * so a shade is seen before it is looked at. The figure is drawn as a blur
 * in the mist, not lit (game/shadeSilhouette.ts), so the headlamp's cone
 * does not bound it.
 */
export const SHADE_BEARING_MIN_COS = 0.9613;
export const SHADE_BEARING_MIN_SIN = 0.2756;
export const SHADE_BEARING_MAX_COS = 0.766;
export const SHADE_BEARING_MAX_SIN = 0.6428;
/** A lunge: where it starts, its speed (over a sprint), how far its line may drift toward its player a second, and its most seconds. */
export const LUNGE_RANGE: readonly [number, number] = [30, 44];
export const LUNGE_SPEED = 6;
/** The strike: within this of its player the lunge stops and strikes, the strike lasting this long, landing this far into it, and killing within this reach. */
export const LUNGE_ATTACK_M = 2.6;
export const LUNGE_ATTACK_S = 0.9;
export const LUNGE_ATTACK_HIT_S = 0.4;
export const LUNGE_ATTACK_REACH = 3.4;
export const LUNGE_DRIFT = 1.2;
export const LUNGE_MAX_S = 16;
/** Metres beyond its player a lunge's line runs. */
export const LUNGE_LINE_M = 60;
/** In the chase: how far along the open way home a guide shade's node may be, how far along the way to it the shade stands, and how far beside it. */
export const GUIDE_REACH: readonly [number, number] = [15, 60];
export const GUIDE_ALONG: readonly [number, number] = [0.55, 0.8];
export const GUIDE_SIDE_M = 3;
/**
 * The pursuit, on the winning tick: PURSUIT_SHADES shades at the trail's
 * entrance and up the stem behind it, PURSUIT_APART_M apart, walking to the
 * car's door at PURSUIT_SPEED (under a sprint's 7), stopping short of the
 * road's bed at PURSUIT_STOP_U from its centreline, or within PURSUIT_ARRIVE_M
 * of the door, and gone PURSUIT_DWELL_S after they stood up.
 */
export const PURSUIT_SHADES = 4;
export const PURSUIT_APART_M = 4;
export const PURSUIT_SPEED = 5.5;
export const PURSUIT_STOP_U = ROAD_WALL_U + 1.5;
export const PURSUIT_ARRIVE_M = 1;
export const PURSUIT_DWELL_S = 25;
/** Placements tried for a shade before the director waits a tick. */
export const HAUNT_PLACE_TRIES = 6;
/** Mixed into the world seed for the haunt's own stream. */
export const HAUNT_SALT = 0x4a7e;

/** Host-only. Off the wire, outside the fingerprint (`World.haunt`, world.ts). */
export type HauntRecord = {
  rng: { rngSeed: number };
  /** Whether the haunt runs at all. */
  active: boolean;
  /** Seconds until the next episode, while none runs. */
  rest: number;
  /** The episode running, or null. */
  episode: { left: number; shades: number; nextShade: number; real: boolean } | null;
};

const between = (rng: { rngSeed: number }, band: readonly [number, number]): number =>
  band[0] + nextRandom(rng) * (band[1] - band[0]);

export function createHauntRecord(seed: number): HauntRecord {
  const rng = { rngSeed: (seed ^ HAUNT_SALT) | 0 };
  return { rng, active: true, rest: between(rng, HAUNT_REST_EARLY), episode: null };
}

/** A shade of the haunt or of the end: a lunge and its strike, a shade standing, a shade in pursuit. */
export function isShadeState(ai: AiState): boolean {
  return ai === AiState.Shade || ai === AiState.Lunge || ai === AiState.Strike || ai === AiState.Pursue;
}

/** How far off the trail the chase's targets are, 0 on it to 1 from OFF_TRAIL_FROM_M + OFF_TRAIL_SPAN_M off: the farthest of them. */
export function offTrailOf(world: World): number {
  if (world.trail === null) return 0;
  let worst = 0;
  for (const p of targetsOf(world)) {
    const t = (trailDistance(world.trail, p.pos.x, p.pos.z) - OFF_TRAIL_FROM_M) / OFF_TRAIL_SPAN_M;
    if (t > worst) worst = t;
  }
  return worst > 1 ? 1 : worst;
}

/** The haunt's pressure for a world: 0 as the mist comes whole, 1 at the crest and in the chase. */
export function pressureOf(world: World): number {
  if (world.state.phase === Phase.Chase) return 1;
  const from = MIST_AT + MIST_SPAN;
  return smootherstep((bestClimb(world) - from) / HAUNT_PRESS_SPAN);
}

/** The best living climb, 0 at the pad and 1 at the crest; 0 with nobody living. */
export function bestClimb(world: World): number {
  const graph = world.trail;
  if (graph === null) return 0;
  let best = 0;
  for (const p of world.state.players.values()) {
    if (p.health <= 0) continue;
    const c = climbOf(graph, p.pos.x, p.pos.z);
    if (c > best) best = c;
  }
  return best;
}

/** Whether the woods are haunted now: the chase, or the climb once the night is in. */
export function isHaunting(world: World): boolean {
  if (world.state.phase === Phase.Chase) return true;
  return actsUnder(bestClimb(world)).mist >= HAUNT_MIST_MIN;
}

/** The players a shade may be shown to: living, and in the chase not yet safe. */
function targetsOf(world: World): PlayerState[] {
  const out: PlayerState[] = [];
  const chase = world.state.phase === Phase.Chase;
  for (const p of world.state.players.values()) {
    if (p.health > 0 && (!chase || !p.safe)) out.push(p);
  }
  return out;
}

/** Standable, off the corridor, clear of every living player by the shade's flee radius, and in a clear sightline from `eye`. */
function admits(world: World, x: number, z: number, eye: Vec3): Vec3 | null {
  if (world.forest === null || world.ground === null) return null;
  const centre = groundSpawn(world.boxes, world.forest.seed, x, z, ENEMY_HALF);
  if (centre === null) return null;
  const normal: Vec3 = { x: 0, y: 0, z: 0 };
  world.ground.normalAt(x, z, normal);
  if (normal.y < WATCH_SLOPE_NY) return null;
  if (isOnCorridor(world, x, z)) return null;
  const clear = SHADE_FLEE_RADIUS + 1;
  for (const p of world.state.players.values()) {
    if (p.health > 0 && horizontalDistSq(p.pos, centre) < clear * clear) return null;
  }
  for (const e of world.state.enemies.values()) {
    if (isShadeState(e.ai) && horizontalDistSq(e.pos, centre) < SHADE_APART_M * SHADE_APART_M) return null;
  }
  if (!hasLineOfSight(eye, centre, world.boxes, world.ground)) return null;
  return centre;
}

/**
 * One try at a place in the band off `target`'s look, by the watcher's
 * method (watcher.ts `placeWatcher`) in the shade's own band: a drawn side,
 * a drawn mix of the band's two edges, at a drawn range. Spends three
 * draws whatever the ground says.
 */
export function placeShade(world: World, target: PlayerState, rng: { rngSeed: number }, range: readonly [number, number]): Vec3 | null {
  const side = nextRandom(rng) < 0.5 ? -1 : 1;
  const mix = nextRandom(rng);
  const metres = between(rng, range);
  if (world.trail === null) return null;
  const look = aimDirection(target.yaw, 0);
  const minX = look.x * SHADE_BEARING_MIN_COS - side * look.z * SHADE_BEARING_MIN_SIN;
  const minZ = side * look.x * SHADE_BEARING_MIN_SIN + look.z * SHADE_BEARING_MIN_COS;
  const maxX = look.x * SHADE_BEARING_MAX_COS - side * look.z * SHADE_BEARING_MAX_SIN;
  const maxZ = side * look.x * SHADE_BEARING_MAX_SIN + look.z * SHADE_BEARING_MAX_COS;
  let bx = (1 - mix) * minX + mix * maxX;
  let bz = (1 - mix) * minZ + mix * maxZ;
  const len = Math.sqrt(bx * bx + bz * bz);
  bx /= len;
  bz /= len;
  const eye: Vec3 = { x: target.pos.x, y: target.pos.y + PLAYER_EYE_OFFSET, z: target.pos.z };
  return admits(world, target.pos.x + bx * metres, target.pos.z + bz * metres, eye);
}

/**
 * One try at a place beside the open way home, for the chase: the nearest
 * guide node within GUIDE_REACH of `target` that is nearer the pad than
 * their own nearest node, the shade a drawn share of the way to it and a
 * drawn side of that line, within the wide view of the target's look. Null
 * without a guide or a node, and then the band placement is used.
 */
export function placeShadeOnGuide(world: World, target: PlayerState, rng: { rngSeed: number }): Vec3 | null {
  const graph = world.trail;
  const cut = world.cut;
  if (graph === null || cut === null || cut.guide.length === 0) return null;
  const mine = nearestTrailNode(graph, target.pos.x, target.pos.z);
  const home = graph.homeDist[mine] as number;
  let best: TrailNode | null = null;
  let bestSq = Infinity;
  for (const gi of cut.guide) {
    if ((graph.homeDist[gi] as number) >= home) continue;
    const n = graph.nodes[gi] as TrailNode;
    const dx = n.x - target.pos.x;
    const dz = n.z - target.pos.z;
    const sq = dx * dx + dz * dz;
    if (sq < GUIDE_REACH[0] * GUIDE_REACH[0] || sq > GUIDE_REACH[1] * GUIDE_REACH[1]) continue;
    if (sq < bestSq) { bestSq = sq; best = n; }
  }
  const along = between(rng, GUIDE_ALONG);
  const side = nextRandom(rng) < 0.5 ? -1 : 1;
  if (best === null) return null;
  const dx = best.x - target.pos.x;
  const dz = best.z - target.pos.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  const x = target.pos.x + dx * along - side * (dz / len) * GUIDE_SIDE_M;
  const z = target.pos.z + dz * along + side * (dx / len) * GUIDE_SIDE_M;
  const look = aimDirection(target.yaw, 0);
  const tx = x - target.pos.x;
  const tz = z - target.pos.z;
  const tl = Math.sqrt(tx * tx + tz * tz);
  if (!(tl > 0) || (tx * look.x + tz * look.z) / tl < WATCH_VIEW_COS) return null;
  const eye: Vec3 = { x: target.pos.x, y: target.pos.y + PLAYER_EYE_OFFSET, z: target.pos.z };
  return admits(world, x, z, eye);
}

/** Adds a shade of `ai` at `at` for `target`, its timer at `timer` and its walk's end at `to`, facing its player. */
function addShade(world: World, at: Vec3, target: PlayerState, ai: AiState, timer: number, to: Vec3 | null): EnemyState {
  const shade: EnemyState = {
    id: world.state.nextEntityId++,
    pos: cloneVec3(at),
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    health: ENEMY_MAX_HEALTH,
    ai,
    targetId: target.id,
    stateTimer: timer,
    // For a shade, the seconds a player has had it in the stare's cone (SHADE_WATCHED_S): a cooldown nothing else here reads.
    attackCooldown: 0,
    lastDistSq: Infinity,
    stuckTimer: 0,
    unstickTimer: 0,
    route: [],
    routeAt: 0,
    approach: false,
    seen: false,
    emergeTo: to,
  };
  faceToward(shade, target.pos.x, target.pos.z);
  world.state.enemies.set(shade.id, shade);
  return shade;
}

/** Spawns a shade or a lunge at `at` for `target`: a shade stands `dwell` seconds, a lunge runs its line LUNGE_LINE_M past the target. */
export function spawnShade(world: World, at: Vec3, target: PlayerState, lunge: boolean, dwell: number): EnemyState {
  const dx = target.pos.x - at.x;
  const dz = target.pos.z - at.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  const line: Vec3 | null = lunge && len > 0 ? { x: target.pos.x + (dx / len) * LUNGE_LINE_M, y: target.pos.y, z: target.pos.z + (dz / len) * LUNGE_LINE_M } : null;
  return addShade(world, at, target, lunge ? AiState.Lunge : AiState.Shade, lunge ? LUNGE_MAX_S : dwell, line);
}

/**
 * The pursuit, host only, from the end rule on the tick the match is won
 * (summit.ts): PURSUIT_SHADES shades of the end stand up on the ground at the
 * trail's entrance and back up the stem from it, PURSUIT_APART_M apart along
 * its first edge, each for the living player nearest it (ties to the lower
 * id), and walk to the car's door spot (`doorSpot`, kept in `emergeTo`).
 * Nothing without a trail, a ground, the car or a living player.
 */
export function startPursuit(world: World): void {
  const graph = world.trail;
  const ground = world.ground;
  const search = world.search;
  if (graph === null || ground === null || search === null) return;
  const car = search.car;
  const door = doorSpot(car, carDirection(car, graph.trailhead));
  const e = trailEntrance(graph);
  for (let k = 0; k < PURSUIT_SHADES; k++) {
    const x = e.x + e.dx * PURSUIT_APART_M * k;
    const z = e.z + e.dz * PURSUIT_APART_M * k;
    let target: PlayerState | null = null;
    let bestSq = Infinity;
    for (const p of world.state.players.values()) {
      if (p.health <= 0) continue;
      const dx = p.pos.x - x, dz = p.pos.z - z;
      const sq = dx * dx + dz * dz;
      if (sq < bestSq || (sq === bestSq && target !== null && p.id < target.id)) { bestSq = sq; target = p; }
    }
    if (target === null) return;
    addShade(world, { x, y: ground.heightAt(x, z) + ENEMY_HALF.y, z }, target, AiState.Pursue, PURSUIT_DWELL_S, { x: door.x, y: 0, z: door.z });
  }
}

/** One tick of a shade, a lunge or a shade of the end; true when it is gone. */
export function stepShade(h: EnemyState, world: World, dt: number): boolean {
  const target = world.state.players.get(h.targetId);
  h.stateTimer -= dt;
  if (h.ai === AiState.Pursue) {
    // It walks to the car's door, the pavement the one ground it never
    // crosses: a step that would end nearer the road's centreline than
    // PURSUIT_STOP_U is not taken, and at the door it stands. Either way it
    // faces the car. No one's nearness sends it away, and no look.
    if (h.stateTimer <= 0) return true;
    const door = h.emergeTo;
    const car = world.search?.car;
    if (door === null || car === undefined) return false;
    if (horizontalDistSq(h.pos, door) > PURSUIT_ARRIVE_M * PURSUIT_ARRIVE_M) {
      const pos = h.pos;
      const vel = h.vel;
      walkToward(h, world, dt, door.x, door.z, PURSUIT_SPEED, false);
      const u = roadOffset(world, h.pos.x, h.pos.z);
      if (u === null || u >= PURSUIT_STOP_U) return false;
      h.pos = pos;
      h.vel = vel;
    }
    h.vel.x = 0;
    h.vel.y = 0;
    h.vel.z = 0;
    faceToward(h, car.x, car.z);
    return false;
  }
  if (h.ai === AiState.Shade) {
    // It stands where it rose and stares: its face to its player, never a step.
    if (target !== undefined && target.health > 0) faceToward(h, target.pos.x, target.pos.z);
    let watched = false;
    for (const p of world.state.players.values()) {
      if (p.health <= 0) continue;
      if (horizontalDistSq(p.pos, h.pos) < SHADE_FLEE_RADIUS * SHADE_FLEE_RADIUS) return true;
      if (playerSees(p, h, world)) watched = true;
    }
    if (watched) h.attackCooldown += dt;
    return h.stateTimer <= 0 || h.attackCooldown >= SHADE_WATCHED_S;
  }
  if (h.ai === AiState.Strike) {
    // The strike: it stands at its player for LUNGE_ATTACK_S; LUNGE_ATTACK_HIT_S
    // in, whoever it struck at within LUNGE_ATTACK_REACH is dead; then it is gone.
    // Never in the summit scene (revealing): the strike is withheld.
    if (target !== undefined && target.health > 0) faceToward(h, target.pos.x, target.pos.z);
    if (h.attackCooldown === 0 && h.stateTimer <= LUNGE_ATTACK_S - LUNGE_ATTACK_HIT_S && !revealing(world)) {
      h.attackCooldown = 1;
      if (target !== undefined && target.health > 0 && !target.safe && horizontalDistSq(h.pos, target.pos) <= LUNGE_ATTACK_REACH * LUNGE_ATTACK_REACH) target.health = 0;
    }
    return h.stateTimer <= 0;
  }
  // The lunge: its line drifts toward its player by at most LUNGE_DRIFT a
  // second, and it walks that line; at arm's length it strikes; past the
  // player, or out of time, or stuck, it is gone. Contact is the Hollows'
  // (updateHollows) as well.
  const line = h.emergeTo;
  if (line === null || h.stateTimer <= 0) return true;
  if (target !== undefined && target.health > 0 && horizontalDistSq(h.pos, target.pos) <= LUNGE_ATTACK_M * LUNGE_ATTACK_M) {
    h.ai = AiState.Strike;
    h.stateTimer = LUNGE_ATTACK_S;
    h.attackCooldown = 0;
    h.vel = { x: 0, y: 0, z: 0 };
    faceToward(h, target.pos.x, target.pos.z);
    return false;
  }
  if (target !== undefined && target.health > 0) {
    const ex = target.pos.x - line.x;
    const ez = target.pos.z - line.z;
    // Drift the far point sideways toward where the player now is, projected to the line's distance.
    const dx = line.x - h.pos.x;
    const dz = line.z - h.pos.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 0) {
      // The player's offset from the line, across it.
      const across = (ex * -dz + ez * dx) / len;
      const step = Math.max(-LUNGE_DRIFT * dt, Math.min(LUNGE_DRIFT * dt, across));
      line.x += (-dz / len) * step;
      line.z += (dx / len) * step;
    }
    const tx = target.pos.x - h.pos.x;
    const tz = target.pos.z - h.pos.z;
    if (tx * dx + tz * dz < 0) return true;
  }
  walkToward(h, world, dt, line.x, line.z, LUNGE_SPEED);
  if (h.stuckTimer > 1.5) return true;
  if (horizontalDistSq(h.pos, line) < 4) return true;
  return false;
}

/**
 * The haunt's tick, host only: steps every shade and lunge, and the shades of
 * the end past the match's end, and, while the match plays, runs the director. No haunting (day, or the night not yet in)
 * ends an episode at once and leaves the rest where it is.
 */
export function stepHaunt(world: World, dt: number): void {
  const record = world.haunt;
  if (record === null || !record.active) return;
  for (const [id, e] of world.state.enemies) {
    if (isShadeState(e.ai) && stepShade(e, world, dt)) world.state.enemies.delete(id);
  }
  // The reveal is the Hollow's alone: while one is stepping out, the director waits.
  for (const e of world.state.enemies.values()) if (e.ai === AiState.Emerge) return;
  if (world.state.outcome !== Outcome.Playing || !isHaunting(world)) {
    record.episode = null;
    return;
  }
  const chase = world.state.phase === Phase.Chase;
  const pressure = pressureOf(world);
  const off = chase ? offTrailOf(world) : 0;
  if (record.episode === null) {
    record.rest -= dt;
    if (record.rest > 0) return;
    const gain = 1 + OFF_TRAIL_SHADES_GAIN * off;
    const fewest = (HAUNT_SHADES_EARLY[0] + (HAUNT_SHADES_LATE[0] - HAUNT_SHADES_EARLY[0]) * pressure) * gain;
    const most = (HAUNT_SHADES_EARLY[1] + (HAUNT_SHADES_LATE[1] - HAUNT_SHADES_EARLY[1]) * pressure) * gain;
    record.episode = {
      left: between(record.rng, HAUNT_EPISODE_S),
      shades: Math.floor(between(record.rng, [fewest, most + 1])),
      nextShade: 0,
      real: nextRandom(record.rng) < (chase ? HAUNT_REAL_CHASE : HAUNT_REAL_CLIMB),
    };
  }
  const ep = record.episode;
  ep.left -= dt;
  ep.nextShade -= dt;
  if (ep.shades > 0 && ep.nextShade <= 0) {
    const targets = targetsOf(world);
    if (targets.length > 0) {
      const target = targets[Math.floor(nextRandom(record.rng) * targets.length) % targets.length] as PlayerState;
      // The episode's last shade is its lunge, when it has one; off the trail in the chase, any shade may be.
      const lunge = (ep.real && ep.shades === 1) || (off > 0 && nextRandom(record.rng) < OFF_TRAIL_REAL_EACH + (1 - OFF_TRAIL_REAL_EACH) * off);
      let at: Vec3 | null = null;
      for (let i = 0; i < HAUNT_PLACE_TRIES && at === null; i++) {
        if (chase && !lunge) at = placeShadeOnGuide(world, target, record.rng);
        if (at === null) at = placeShade(world, target, record.rng, lunge ? LUNGE_RANGE : SHADE_RANGE);
      }
      if (at !== null) {
        spawnShade(world, at, target, lunge, between(record.rng, SHADE_DWELL_S));
        ep.shades--;
        // Off the trail the shades come that much faster too: an episode's count alone would run out its clock.
        ep.nextShade = between(record.rng, HAUNT_SHADE_GAP_S) / (1 + OFF_TRAIL_SHADES_GAIN * off);
      }
    }
  }
  if (ep.left <= 0 || ep.shades === 0) {
    record.episode = null;
    record.rest = chase
      ? between(record.rng, HAUNT_REST_CHASE)
      : between(record.rng, [
        HAUNT_REST_EARLY[0] + (HAUNT_REST_LATE[0] - HAUNT_REST_EARLY[0]) * pressure,
        HAUNT_REST_EARLY[1] + (HAUNT_REST_LATE[1] - HAUNT_REST_EARLY[1]) * pressure,
      ]);
  }
}
