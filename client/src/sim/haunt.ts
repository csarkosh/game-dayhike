/**
 * The haunt (docs/gameplay/2026-10-06-the-haunt.md): the night's shadow
 * figures. A director on the host runs episodes once the night is in, and
 * through the chase: for a dozen or twenty seconds, every few seconds, a
 * shade stands up somewhere at the edge of a player's sight and stands and
 * stares at them, and is gone again when they come near, when they look at
 * it too long, or when its time is up. Every one stands SHADE_TRAIL_OFF_M
 * off the trail, ahead of its player, where it comes out of the mist
 * (2026-10-20). On the climb every one is nothing, and nothing before the
 * chase can kill. In the chase one in an episode, sometimes, is real (a
 * lunge): from where it stood up it walks at its player, wherever they go,
 * and at arm's length it strikes, which kills within its reach; a player
 * who keeps moving down the trail outwalks it, and it goes when its time is
 * up. The haunt begins once the mist is whole on the ground, lightly, and
 * presses harder the nearer the party is to the crest. In the chase a shade
 * stands off the open way home: the thing that hunts the party also shows
 * them the way.
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
import type { TrailGraph, TrailNode } from "./trail.js";
import { nearestTrailNode } from "./trail.js";
import { groundSpawn } from "./spawn.js";
import { hasLineOfSight } from "./ai.js";
import { aimDirection } from "./view.js";
import { isOnCorridor } from "./containment.js";
import { faceToward, horizontalDistSq, playerSees, revealing, walkToward } from "./hollow.js";
import { climbOf, WATCH_SLOPE_NY } from "./watcher.js";
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
/** The chance an episode's last shade is a lunge, in the chase. On the climb there is none (2026-10-20; 0.55 before): nothing kills before the chase. */
export const HAUNT_REAL_CHASE = 0.9;
/** Seconds before a real episode's end by which its lunge comes, if its last shade has not: where few places stand, the count alone would run out the clock first. */
export const HAUNT_REAL_BY_S = 6;
/** How long a shade stands, how near a player may come, and how long it may be looked at. */
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
 * Where every shade and lunge stands (2026-10-20; on the climb first, then
 * in the chase): metres off the trail, measured from its centreline as
 * `trailDistance` measures, and how far along its player's look the trail
 * point it stands off may be. It must be in view, from SHADE_BEARING_MIN_COS
 * (16°, just outside the stare's 20°, so a shade is seen before it is
 * looked at) to SHADE_TRAIL_BEARING_MAX_COS (50°) off the look. The figure
 * is drawn as a blur in the mist, not lit (game/shadeSilhouette.ts), so the
 * headlamp's cone does not bound it.
 */
export const SHADE_BEARING_MIN_COS = 0.9613;
export const SHADE_BEARING_MIN_SIN = 0.2756;
export const SHADE_TRAIL_OFF_M: readonly [number, number] = [15, 20];
export const SHADE_AHEAD_M: readonly [number, number] = [12, 40];
export const SHADE_TRAIL_BEARING_MAX_COS = 0.6428;
export const SHADE_TRAIL_BEARING_MAX_SIN = 0.766;
/** Where the stand off the trail ahead finds nothing (near the trail's end, at a bend), a place in the view band itself at this range, kept when it is SHADE_TRAIL_OFF_M off the trail. */
export const SHADE_BAND_RANGE_M: readonly [number, number] = [15, 45];
/**
 * A lunge, the real one: it walks at its player, wherever they are, at
 * LUNGE_SPEED (under the player's walk, so one who keeps moving down the
 * trail outwalks it; one who stops, or comes back toward it, is reached),
 * for at most LUNGE_MAX_S, long enough to cross the 40 m it may stand off
 * a player who stands. (Until 2026-10-20 it came at 6 m/s from 30 to 44 m
 * along a line through its player that drifted toward them at 1.2 m/s, for
 * at most 16 s, and a player who stepped out of the line saw it pass.)
 */
export const LUNGE_SPEED = 4;
export const LUNGE_MAX_S = 40;
/** The strike: within this of its player the lunge stops and strikes, the strike lasting this long, landing this far into it, and killing within this reach. */
export const LUNGE_ATTACK_M = 2.6;
export const LUNGE_ATTACK_S = 0.9;
export const LUNGE_ATTACK_HIT_S = 0.4;
export const LUNGE_ATTACK_REACH = 3.4;
/** In the chase: how far along the open way home a guide shade's node may be, and how far along the way to it the trail point it stands off (SHADE_TRAIL_OFF_M) is. */
export const GUIDE_REACH: readonly [number, number] = [15, 60];
export const GUIDE_ALONG: readonly [number, number] = [0.55, 0.8];
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

export function isShadeState(ai: AiState): boolean {
  return ai === AiState.Shade || ai === AiState.Lunge || ai === AiState.Strike;
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
 * The point of the trail nearest (x, z), and the unit direction of the edge
 * it is on: on any edge, or, given `path` (node indices in order, the
 * guide's), on the segments between its nodes alone.
 */
export function nearestOnTrail(graph: TrailGraph, x: number, z: number, path: readonly number[] | null = null): { x: number; z: number; tx: number; tz: number } {
  let best = { x, z, tx: 1, tz: 0 };
  let bestSq = Infinity;
  const segments = path === null ? graph.edges.length : path.length - 1;
  for (let k = 0; k < segments; k++) {
    const ia = path === null ? (graph.edges[k] as { a: number }).a : (path[k] as number);
    const ib = path === null ? (graph.edges[k] as { b: number }).b : (path[k + 1] as number);
    const a = graph.nodes[ia] as TrailNode;
    const b = graph.nodes[ib] as TrailNode;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const l2 = ex * ex + ez * ez;
    if (!(l2 > 0)) continue;
    const t = Math.min(1, Math.max(0, ((x - a.x) * ex + (z - a.z) * ez) / l2));
    const px = a.x + t * ex;
    const pz = a.z + t * ez;
    const sq = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (sq < bestSq) {
      const l = Math.sqrt(l2);
      bestSq = sq;
      best = { x: px, z: pz, tx: ex / l, tz: ez / l };
    }
  }
  return best;
}

/**
 * The place `off` metres to `side` across the trail from its point `on`,
 * kept when it is in view of `target` (SHADE_BEARING_MIN_COS to
 * SHADE_TRAIL_BEARING_MAX_COS off the look), admitted (`admits`), and that
 * far from every edge, not nearer another branch.
 */
function standOff(world: World, graph: TrailGraph, target: PlayerState, on: { x: number; z: number; tx: number; tz: number }, side: number, off: number): Vec3 | null {
  const x = on.x - side * on.tz * off;
  const z = on.z + side * on.tx * off;
  const look = aimDirection(target.yaw, 0);
  const bx = x - target.pos.x;
  const bz = z - target.pos.z;
  const len = Math.sqrt(bx * bx + bz * bz);
  if (!(len > 0)) return null;
  const cos = (bx * look.x + bz * look.z) / len;
  if (cos > SHADE_BEARING_MIN_COS || cos < SHADE_TRAIL_BEARING_MAX_COS) return null;
  const eye: Vec3 = { x: target.pos.x, y: target.pos.y + PLAYER_EYE_OFFSET, z: target.pos.z };
  const at = admits(world, x, z, eye);
  if (at === null) return null;
  const d = trailDistance(graph, at.x, at.z);
  return d >= SHADE_TRAIL_OFF_M[0] && d <= SHADE_TRAIL_OFF_M[1] ? at : null;
}

/**
 * One try at a place off the trail, for every shade and lunge: the point of
 * the trail nearest a drawn SHADE_AHEAD_M along `target`'s look, and from it
 * a drawn side across the trail at a drawn SHADE_TRAIL_OFF_M (`standOff`);
 * where that is out of view (near the trail's end, at a bend), a drawn
 * bearing in the view band, to a drawn side, at a drawn SHADE_BAND_RANGE_M,
 * kept when it stands SHADE_TRAIL_OFF_M off the trail. The bearing mixes the
 * band's two edges, the watcher's method (watcher.ts), without trig. Spends
 * six draws whatever the ground says.
 */
export function placeShadeOffTrail(world: World, target: PlayerState, rng: { rngSeed: number }): Vec3 | null {
  const side = nextRandom(rng) < 0.5 ? -1 : 1;
  const ahead = between(rng, SHADE_AHEAD_M);
  const off = between(rng, SHADE_TRAIL_OFF_M);
  const bandSide = nextRandom(rng) < 0.5 ? -1 : 1;
  const mix = nextRandom(rng);
  const range = between(rng, SHADE_BAND_RANGE_M);
  const graph = world.trail;
  if (graph === null) return null;
  const look = aimDirection(target.yaw, 0);
  const stood = standOff(world, graph, target, nearestOnTrail(graph, target.pos.x + look.x * ahead, target.pos.z + look.z * ahead), side, off);
  if (stood !== null) return stood;
  const minX = look.x * SHADE_BEARING_MIN_COS - bandSide * look.z * SHADE_BEARING_MIN_SIN;
  const minZ = bandSide * look.x * SHADE_BEARING_MIN_SIN + look.z * SHADE_BEARING_MIN_COS;
  const maxX = look.x * SHADE_TRAIL_BEARING_MAX_COS - bandSide * look.z * SHADE_TRAIL_BEARING_MAX_SIN;
  const maxZ = bandSide * look.x * SHADE_TRAIL_BEARING_MAX_SIN + look.z * SHADE_TRAIL_BEARING_MAX_COS;
  const bx = (1 - mix) * minX + mix * maxX;
  const bz = (1 - mix) * minZ + mix * maxZ;
  const len = Math.sqrt(bx * bx + bz * bz);
  const eye: Vec3 = { x: target.pos.x, y: target.pos.y + PLAYER_EYE_OFFSET, z: target.pos.z };
  const at = admits(world, target.pos.x + (bx / len) * range, target.pos.z + (bz / len) * range, eye);
  if (at === null) return null;
  const d = trailDistance(graph, at.x, at.z);
  return d >= SHADE_TRAIL_OFF_M[0] && d <= SHADE_TRAIL_OFF_M[1] ? at : null;
}

/**
 * One try at a place off the open way home, for the chase: the nearest
 * guide node within GUIDE_REACH of `target` that is nearer the pad than
 * their own nearest node, the point of the guide's own path nearest a drawn
 * share of the way to it, and from that point a drawn side at a drawn
 * SHADE_TRAIL_OFF_M (`standOff`): beside the branch that is open, never a
 * closed one. Null without a guide or a node, and then the plain stand off
 * the trail is used. Spends three draws.
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
  const off = between(rng, SHADE_TRAIL_OFF_M);
  if (best === null) return null;
  const on = nearestOnTrail(graph, target.pos.x + (best.x - target.pos.x) * along, target.pos.z + (best.z - target.pos.z) * along, cut.guide);
  return standOff(world, graph, target, on, side, off);
}

/** Spawns a shade or a lunge at `at` for `target`: a shade stands `dwell` seconds, a lunge walks at the target for at most LUNGE_MAX_S. */
export function spawnShade(world: World, at: Vec3, target: PlayerState, lunge: boolean, dwell: number): EnemyState {
  const shade: EnemyState = {
    id: world.state.nextEntityId++,
    pos: cloneVec3(at),
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    health: ENEMY_MAX_HEALTH,
    ai: lunge ? AiState.Lunge : AiState.Shade,
    targetId: target.id,
    stateTimer: lunge ? LUNGE_MAX_S : dwell,
    // For a shade, the seconds a player has had it in the stare's cone (SHADE_WATCHED_S): a cooldown nothing else here reads.
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
  faceToward(shade, target.pos.x, target.pos.z);
  world.state.enemies.set(shade.id, shade);
  return shade;
}

/** One tick of a shade or a lunge; true when it is gone. */
export function stepShade(h: EnemyState, world: World, dt: number): boolean {
  const target = world.state.players.get(h.targetId);
  h.stateTimer -= dt;
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
  // The real one: it walks at its player, wherever they are; at arm's
  // length it strikes. Out of time, stuck, or its player dead or safe, it
  // is gone. Contact is the Hollows' (updateHollows) as well.
  if (h.stateTimer <= 0 || target === undefined || target.health <= 0 || target.safe) return true;
  if (horizontalDistSq(h.pos, target.pos) <= LUNGE_ATTACK_M * LUNGE_ATTACK_M) {
    h.ai = AiState.Strike;
    h.stateTimer = LUNGE_ATTACK_S;
    h.attackCooldown = 0;
    h.vel = { x: 0, y: 0, z: 0 };
    faceToward(h, target.pos.x, target.pos.z);
    return false;
  }
  walkToward(h, world, dt, target.pos.x, target.pos.z, LUNGE_SPEED);
  return h.stuckTimer > 1.5;
}

/**
 * The haunt's tick, host only: steps every shade and lunge, and, while the
 * match plays, runs the director. No haunting (day, or the night not yet in)
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
      // Nothing before the chase kills: the climb's episodes have no lunge.
      real: chase && nextRandom(record.rng) < HAUNT_REAL_CHASE,
    };
  }
  const ep = record.episode;
  ep.left -= dt;
  ep.nextShade -= dt;
  if (ep.shades > 0 && ep.nextShade <= 0) {
    const targets = targetsOf(world);
    if (targets.length > 0) {
      const target = targets[Math.floor(nextRandom(record.rng) * targets.length) % targets.length] as PlayerState;
      // The episode's last shade is its lunge, when it has one, or the shade placed once only HAUNT_REAL_BY_S is left; off the trail in the chase, any shade may be.
      const lunge = (ep.real && (ep.shades === 1 || ep.left <= HAUNT_REAL_BY_S)) || (off > 0 && nextRandom(record.rng) < OFF_TRAIL_REAL_EACH + (1 - OFF_TRAIL_REAL_EACH) * off);
      let at: Vec3 | null = null;
      // Every one stands off the trail ahead of its player; in the chase a shade first off the open way home.
      for (let i = 0; i < HAUNT_PLACE_TRIES && at === null; i++) {
        if (chase && !lunge) at = placeShadeOnGuide(world, target, record.rng);
        if (at === null) at = placeShadeOffTrail(world, target, record.rng);
      }
      if (at !== null) {
        spawnShade(world, at, target, lunge, between(record.rng, SHADE_DWELL_S));
        // One real one an episode: once it has come, the rest are shades.
        if (lunge) ep.real = false;
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
