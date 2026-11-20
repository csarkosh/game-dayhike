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
 * Hollow with the shadow's look (game/lite/shadeMask.ts). The lens and the
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
import type { TrailGraph, TrailNode } from "@csarkosh/engine/sim/trail";
import { groundSpawn } from "./spawn.js";
import { hasLineOfSight } from "./ai.js";
import { aimDirection } from "./view.js";
import { isOnCorridor } from "./containment.js";
import { faceToward, horizontalDistSq, playerSees, revealing, walkToward } from "./hollow.js";
import { climbOf, WATCH_SLOPE_NY } from "./watcher.js";
import { actsUnder, MIST_AT, MIST_SPAN, smootherstep } from "./acts.js";
import { chaseLineDistance, onWay } from "./chaseLine.js";
import { wayDirection, wayPoint, wayProject } from "./wayDown.js";
import { causeOfDeath } from "./deathCause.js";
import { decided } from "./checkpoint.js";
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
 * is drawn as a blur in the mist, not lit (game/lite/shadeMask.ts), so the
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
/**
 * The way's lungers (2026-11-19). The crowd beside the way down is each
 * screen's own (game/crowdField.ts): it lunges at a runner and stops short,
 * and kills only one who walks into it. So some of what lunges is the host's,
 * and stands in the path. All the
 * way down, a lunge stands up beside the path ahead of whoever leads each
 * group of runners: WAYLAY_AHEAD_M down the way from them, WAYLAY_OFF_M from
 * its line (in the thick mist at the path's edge, among the crowd), on a
 * drawn side, WAYLAY_GAP_M of way on from the one before (WAYLAY_GAP_EARLY
 * times that at the way's start, easing to once by three tenths of it), none
 * in the way's first WAYLAY_FROM_M (a quarter of a minute's sprint). It waits there. When its player is
 * within WAYLAY_LOOSE_M of it down the way (over three seconds of sprint) it
 * lunges onto the path as the crowd's do, at WAYLAY_SPEED, straight out
 * from where it waited to WAYLAY_SIDE_M short of the way's line, and stands
 * there. Whoever comes within WAYLAY_REACH_M of it, it has: its strike
 * lands at once (a lunge's own strike stops 2.6 m short and lands 0.4 s on,
 * which a sprinter outruns or does not by a hand's width; this one is to be
 * read at a sprint). It never crosses the line and it follows nobody. So
 * the middle of the path and a strip of its own half are death, and the far
 * half, from a metre off the line, is safe however the meeting is timed: a
 * clean run reads the mist ahead and goes round each one on the side it did
 * not come from, and no two are met within five seconds of each other. It
 * is gone WAYLAY_RUN_S after it is loosed, or once its player is
 * WAYLAY_PAST_M past it; players within WAYLAY_GROUP_M of one ahead of them
 * down the way are that one's group and are given none of their own.
 */
export const WAYLAY_AHEAD_M: readonly [number, number] = [40, 60];
export const WAYLAY_OFF_M: readonly [number, number] = [7, 8];
export const WAYLAY_GAP_M: readonly [number, number] = [40, 70];
export const WAYLAY_REACH_M = 2;
export const WAYLAY_SIDE_M = 1;
export const WAYLAY_GAP_EARLY = 1.6;
export const WAYLAY_FROM_M = 110;
export const WAYLAY_LOOSE_M = 24;
/** The crowd's lunge (game/crowdField.ts CROWD_LUNGE_MPS; a test holds the two equal). */
export const WAYLAY_SPEED = 8;
export const WAYLAY_RUN_S = 6;
export const WAYLAY_PAST_M = 8;
export const WAYLAY_GROUP_M = 60;
/** Seconds one waits for its player at the most, the share of the way by which they stand at their closest, and the metres of the way's end none stands in. */
const WAYLAY_WAIT_S = 60;
const WAYLAY_FULL_AT = 0.3;
const WAYLAY_END_M = 30;
/** Metres from its place on the path within which a loosed one has reached it, and the seconds of no progress toward it after which it stands where it is. */
const WAYLAY_STOOD_M = 0.3;
const WAYLAY_HELD_S = 0.1;
/** Metres further on a place is tried at where the ground refused the last. */
const WAYLAY_RETRY_M = 5;
const WAYLAY_ON = { x: 0, z: 0 }, WAYLAY_ALONG = { x: 0, z: 0 };
/** Placements tried for a shade in one attempt. */
export const HAUNT_PLACE_TRIES = 6;
/**
 * Seconds from an attempt that placed nothing to the next. Tried again every
 * tick (to 2026-11-11), a shade due where nothing admits one (dense forest,
 * a steep bank) cast the attempt's sight lines sixty times a second until
 * its episode ran out, each a march through the ground at the eye's height,
 * where the walkable rock is asked at every step: half of the main thread
 * for twenty to thirty seconds on the rig that measured it, walking.
 */
export const HAUNT_RETRY_S = 0.25;
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
  /** The way's lungers: for each player who leads a group, the metres down the way the next one stands at. */
  waylay: Map<number, number>;
};

const between = (rng: { rngSeed: number }, band: readonly [number, number]): number =>
  band[0] + nextRandom(rng) * (band[1] - band[0]);

export function createHauntRecord(seed: number): HauntRecord {
  const rng = { rngSeed: (seed ^ HAUNT_SALT) | 0 };
  return { rng, active: true, rest: between(rng, HAUNT_REST_EARLY), episode: null, waylay: new Map() };
}

export function isShadeState(ai: AiState): boolean {
  return ai === AiState.Shade || ai === AiState.Lunge || ai === AiState.Strike;
}

/** How far off the chase's line (chaseLine.ts: the way down, or the trail) its targets are, 0 on it to 1 from OFF_TRAIL_FROM_M + OFF_TRAIL_SPAN_M off: the farthest of them. */
export function offTrailOf(world: World): number {
  if (world.trail === null) return 0;
  let worst = 0;
  for (const p of targetsOf(world)) {
    const t = (chaseLineDistance(world, p.pos.x, p.pos.z) - OFF_TRAIL_FROM_M) / OFF_TRAIL_SPAN_M;
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

/** Standable, off the corridor, clear of every living player by the shade's flee radius, and in a clear sightline from `eye` (none asked for with no eye). */
function admits(world: World, x: number, z: number, eye: Vec3 | null): Vec3 | null {
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
  if (eye !== null && !hasLineOfSight(eye, centre, world.boxes, world.ground)) return null;
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
  const d = chaseLineDistance(world, at.x, at.z);
  return d >= SHADE_TRAIL_OFF_M[0] && d <= SHADE_TRAIL_OFF_M[1] ? at : null;
}

/** The point of the line nearest (x, z) and its direction there: the way down's once the chase holds to it (chaseLine.ts), else the trail's. */
function nearestOnLine(world: World, graph: TrailGraph, x: number, z: number): { x: number; z: number; tx: number; tz: number } {
  if (world.way === null || !onWay(world)) return nearestOnTrail(graph, x, z);
  const s = wayProject(world.way, x, z).s;
  const at = wayPoint(world.way, s, { x: 0, z: 0 }), along = wayDirection(world.way, s, { x: 0, z: 0 });
  return { x: at.x, z: at.z, tx: along.x, tz: along.z };
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
  const stood = standOff(world, graph, target, nearestOnLine(world, graph, target.pos.x + look.x * ahead, target.pos.z + look.z * ahead), side, off);
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
  const d = chaseLineDistance(world, at.x, at.z);
  // Where the chase holds its players to the way down, the line is the one way home, with no other trail
  // beside it: a player who has left it is answered where they are. The place may stand as much further off
  // the line as they have gone, and never nearer it than a shade ever stands.
  const gone = onWay(world) ? chaseLineDistance(world, target.pos.x, target.pos.z) : 0;
  return d >= SHADE_TRAIL_OFF_M[0] && d <= SHADE_TRAIL_OFF_M[1] + gone ? at : null;
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
    emergeTo: null, stalks: false, waylay: 0,
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
      // A player just returned is held, and a match already won kills nobody: the blow passes them (checkpoint.ts).
      if (target !== undefined && target.health > 0 && !target.safe && target.heldFor <= 0 && !decided(world) && horizontalDistSq(h.pos, target.pos) <= LUNGE_ATTACK_REACH * LUNGE_ATTACK_REACH) {
        target.cause = causeOfDeath(world, target, h, "strike");
        target.killedBy = h.id;
        target.health = 0;
      }
    }
    return h.stateTimer <= 0;
  }
  // The real one: it walks at its player, wherever they are; at arm's
  // length it strikes. Out of time, stuck, or its player dead or safe, it
  // is gone. Contact is the Hollows' (updateHollows) as well.
  if (h.stateTimer <= 0 || target === undefined || target.health <= 0 || target.safe) return true;
  if (h.waylay !== 0 && !h.approach) {
    // One of the way's: it waits where it rose, its face to its player, until they are within its reach down
    // the way (or of it, however they came). A player gone back up the way, or past it unmet, has left it behind.
    faceToward(h, target.pos.x, target.pos.z);
    const way = world.way;
    if (way === null) return true;
    const gap = wayProject(way, h.pos.x, h.pos.z).s - wayProject(way, target.pos.x, target.pos.z).s;
    if (gap > WAYLAY_AHEAD_M[1] + WAYLAY_GAP_M[1] || gap < -WAYLAY_LOOSE_M) return true;
    if (gap <= WAYLAY_LOOSE_M || horizontalDistSq(h.pos, target.pos) <= WAYLAY_LOOSE_M * WAYLAY_LOOSE_M) {
      // Loosed: straight out onto the path from where it waited, to just short of the way's line on its own side.
      const mine = wayProject(way, h.pos.x, h.pos.z).s;
      const on = wayPoint(way, mine, WAYLAY_ON), along = wayDirection(way, mine, WAYLAY_ALONG);
      h.emergeTo = { x: on.x - along.z * h.waylay * WAYLAY_SIDE_M, y: h.pos.y, z: on.z + along.x * h.waylay * WAYLAY_SIDE_M };
      h.approach = true;
      h.stateTimer = WAYLAY_RUN_S;
      h.lastDistSq = Infinity;
    }
    return false;
  }
  if (h.waylay !== 0) {
    // One of the way's, loosed. Its player well past it, it is gone. It has whoever it reaches: the strike, its blow due at once.
    const way = world.way, to = h.emergeTo;
    if (way === null || to === null) return true;
    if (wayProject(way, target.pos.x, target.pos.z).s - wayProject(way, h.pos.x, h.pos.z).s > WAYLAY_PAST_M) return true;
    if (horizontalDistSq(h.pos, target.pos) <= WAYLAY_REACH_M * WAYLAY_REACH_M) {
      h.ai = AiState.Strike;
      h.stateTimer = LUNGE_ATTACK_S - LUNGE_ATTACK_HIT_S;
      h.attackCooldown = 0;
      h.vel = { x: 0, y: 0, z: 0 };
      faceToward(h, target.pos.x, target.pos.z);
      return false;
    }
  } else if (horizontalDistSq(h.pos, target.pos) <= LUNGE_ATTACK_M * LUNGE_ATTACK_M) {
    h.ai = AiState.Strike;
    h.stateTimer = LUNGE_ATTACK_S;
    h.attackCooldown = 0;
    h.vel = { x: 0, y: 0, z: 0 };
    faceToward(h, target.pos.x, target.pos.z);
    return false;
  }
  if (h.waylay !== 0) {
    // To its place on the path, and there it stands, its face to its player.
    const to = h.emergeTo as Vec3;
    const dx = to.x - h.pos.x, dz = to.z - h.pos.z;
    if (dx * dx + dz * dz <= WAYLAY_STOOD_M * WAYLAY_STOOD_M) {
      h.vel = { x: 0, y: 0, z: 0 };
      faceToward(h, target.pos.x, target.pos.z);
      return false;
    }
    walkToward(h, world, dt, to.x, to.z, WAYLAY_SPEED);
    faceToward(h, target.pos.x, target.pos.z);
    // Held off its place by something that stands in its way, it stands where it is held: it never turns aside
    // to find a way round (the walk's own answer to being held), which could carry it across the line.
    if (h.stuckTimer > WAYLAY_HELD_S) {
      to.x = h.pos.x;
      to.z = h.pos.z;
      h.stuckTimer = 0;
      h.unstickTimer = 0;
    }
    return false;
  }
  walkToward(h, world, dt, target.pos.x, target.pos.z, LUNGE_SPEED);
  return h.stuckTimer > 1.5;
}

/**
 * The way's lungers' director (see WAYLAY_AHEAD_M): for each player on the
 * way who leads a group, stands the next lunge up beside the path once its
 * place is within WAYLAY_AHEAD_M of them down the way. One place is tried a
 * tick; ground that refuses it moves the place on a little.
 */
function stepWaylay(world: World, record: HauntRecord): void {
  const way = world.way;
  if (way === null || !onWay(world)) return;
  const targets = targetsOf(world);
  for (const p of targets) {
    if (chaseLineDistance(world, p.pos.x, p.pos.z) > 0) continue;
    const s = wayProject(way, p.pos.x, p.pos.z).s;
    // Another runner ahead of this one within a group's length leads it: theirs are this one's too.
    let led = false;
    for (const q of targets) {
      if (q === p || chaseLineDistance(world, q.pos.x, q.pos.z) > 0) continue;
      const ahead = wayProject(way, q.pos.x, q.pos.z).s - s;
      if (ahead > 0 && ahead <= WAYLAY_GROUP_M) led = true;
    }
    if (led) continue;
    const nearest = Math.max(WAYLAY_FROM_M, s + WAYLAY_AHEAD_M[0]);
    let next = record.waylay.get(p.id);
    // No place yet, one the player has outrun, or one left far down the way by a player returned to the crest.
    if (next === undefined || next < nearest || next > s + WAYLAY_AHEAD_M[1] + 2 * WAYLAY_GAP_M[1] * WAYLAY_GAP_EARLY) next = nearest;
    if (next > s + WAYLAY_AHEAD_M[1] || next > way.length - WAYLAY_END_M) {
      record.waylay.set(p.id, next);
      continue;
    }
    // Never within a gap of one that stands already, whoever it stands for: a runner who takes the lead is not
    // given one beside the last leader's, on the path's other half.
    let crowded = false;
    for (const e of world.state.enemies.values()) {
      if (e.waylay === 0) continue;
      const es = wayProject(way, e.pos.x, e.pos.z).s;
      if (es > next - WAYLAY_GAP_M[0] && es < next + WAYLAY_GAP_M[0]) {
        next = es + WAYLAY_GAP_M[0];
        crowded = true;
      }
    }
    if (crowded) {
      record.waylay.set(p.id, next);
      continue;
    }
    const side = nextRandom(record.rng) < 0.5 ? -1 : 1;
    const off = between(record.rng, WAYLAY_OFF_M);
    const on = wayPoint(way, next, { x: 0, z: 0 }), along = wayDirection(way, next, { x: 0, z: 0 });
    const at = admits(world, on.x - side * along.z * off, on.z + side * along.x * off, null);
    if (at === null) {
      record.waylay.set(p.id, next + WAYLAY_RETRY_M);
      continue;
    }
    const lunge = spawnShade(world, at, p, true, 0);
    lunge.waylay = side;
    lunge.stateTimer = WAYLAY_WAIT_S;
    const early = 1 + (WAYLAY_GAP_EARLY - 1) * (1 - smootherstep(next / (way.length * WAYLAY_FULL_AT)));
    record.waylay.set(p.id, next + between(record.rng, WAYLAY_GAP_M) * early);
  }
  for (const id of record.waylay.keys()) if (!world.state.players.has(id)) record.waylay.delete(id);
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
  // (Not for one stepping out to meet a returning player, returns.ts: that is one player's scene, and the rest are still running.)
  for (const e of world.state.enemies.values()) if (e.ai === AiState.Emerge && !e.stalks) return;
  if (world.state.outcome !== Outcome.Playing || !isHaunting(world)) {
    record.episode = null;
    return;
  }
  const chase = world.state.phase === Phase.Chase;
  if (chase) stepWaylay(world, record);
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
      // On the way down the path's own lunges are the way's (stepWaylay), which a runner reads by where they wait: the
      // episode's own, which walks in from far off the line, is not raised there. Leaving the way is answered as before.
      const lunge = (ep.real && !onWay(world) && (ep.shades === 1 || ep.left <= HAUNT_REAL_BY_S)) || (off > 0 && nextRandom(record.rng) < OFF_TRAIL_REAL_EACH + (1 - OFF_TRAIL_REAL_EACH) * off);
      let at: Vec3 | null = null;
      // On the way down the standing shades are the crowd's, each screen's own (game/crowdField.ts): the haunt raises
      // only what lunges, and a shade that would only have stood is one of the episode's count gone by.
      const stands = !lunge && onWay(world);
      // Every one stands off the line ahead of its player: the trail, or in the chase the way down (chaseLine.ts).
      for (let i = 0; i < HAUNT_PLACE_TRIES && at === null && !stands; i++) at = placeShadeOffTrail(world, target, record.rng);
      if (stands) {
        ep.shades--;
        ep.nextShade = between(record.rng, HAUNT_SHADE_GAP_S) / (1 + OFF_TRAIL_SHADES_GAIN * off);
      } else if (at !== null) {
        spawnShade(world, at, target, lunge, between(record.rng, SHADE_DWELL_S));
        // One real one an episode: once it has come, the rest are shades.
        if (lunge) ep.real = false;
        ep.shades--;
        // Off the trail the shades come that much faster too: an episode's count alone would run out its clock.
        ep.nextShade = between(record.rng, HAUNT_SHADE_GAP_S) / (1 + OFF_TRAIL_SHADES_GAIN * off);
      } else {
        ep.nextShade = HAUNT_RETRY_S;
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
