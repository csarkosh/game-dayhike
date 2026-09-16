/**
 * The Hollow (docs/gameplay/2026-09-15-the-hollow.md): the figure that walks
 * the trail from the first tick. Free, it crawls the stem pad to crest to pad;
 * bound to a player by their pick-up, it hunts them; released while another
 * Hollow exists, it walks to that one and merges. It cannot be killed. Contact
 * kills, and being looked at slows it at the price of the looker's stare.
 *
 * A Hollow is an `EnemyState` whose `ai` is Crawl, Hunt or Merge, so the
 * snapshot's enemy channel carries it as it carries any enemy. Everything
 * here runs inside `tickWorld`'s authoritative branch: host-only, never
 * replayed on a client. That is why `Math.atan2` for the facing is allowed
 * (architecture.test.ts) — an engine difference cannot diverge two peers.
 * The walk itself passes its direction as a world-axis wish through
 * `stepMovement` with yaw 0, so movement needs no trig at all.
 */
import type { EnemyState, Vec3 } from "./types.js";
import { AiState, Button, cloneVec3 } from "./types.js";
import type { World } from "./world.js";
import type { TrailGraph, TrailNode } from "./trail.js";
import { nearestTrailNode } from "./trail.js";
import { route, stemNodes } from "./trailRoute.js";
import { stepMovement } from "./movement.js";
import { STUCK_EPSILON, STUCK_SECONDS, UNSTICK_SECONDS, hasLineOfSight } from "./ai.js";
import { ENEMY_HALF, ENEMY_MAX_HEALTH, EPSILON, SPRINT_SPEED, WALK_SPEED } from "./constants.js";

/** Free: the stem pendulum, m/s. A 600 m stem takes about twelve minutes one way. */
export const HOLLOW_CRAWL_SPEED = 0.8;
/** Bound or merging, m/s: above WALK_SPEED 5.25, below SPRINT_SPEED 7. */
export const HOLLOW_HUNT_SPEED = 6;
/** Its speed while a living player has it in view. */
export const HOLLOW_LOOK_FACTOR = 0.35;
/** cos 20°: it must be near the centre of the view, not the edge. */
export const HOLLOW_LOOK_COS = 0.9397;
/** Metres from the eye within which looking counts. */
export const HOLLOW_LOOK_RANGE = 120;
/** Seconds of continuous looking that fill the stare from 0 to 1. */
export const HOLLOW_STARE_FILL_S = 6;
/** Seconds of looking away that empty it from 1 to 0. */
export const HOLLOW_STARE_EMPTY_S = 3;
/** Added to the two half-widths: the hulls need not interpenetrate to touch. */
export const HOLLOW_CONTACT_MARGIN = 0.1;
/** A merging Hollow within this of another is absorbed. */
export const HOLLOW_MERGE_RADIUS = 1;
/** Horizontal metres within which a route node counts as reached. */
export const HOLLOW_WAYPOINT_RADIUS = 1.5;
/** Within this of its target, with line of sight, it leaves the graph. */
export const HOLLOW_APPROACH_RANGE = 25;
/** Off the graph and blind to its target this long, it re-routes. */
export const HOLLOW_LOST_SIGHT_S = 3;
/** The placeholder's height, metres (entityViews.ts). */
export const HOLLOW_HEIGHT = 2.6;

export function isHollowState(ai: AiState): boolean {
  return ai === AiState.Crawl || ai === AiState.Hunt || ai === AiState.Merge;
}

export function isHollow(e: EnemyState): boolean {
  return isHollowState(e.ai);
}

export function spawnHollow(world: World, at: Vec3, ai: AiState, targetId = 0): EnemyState {
  const hollow: EnemyState = {
    id: world.state.nextEntityId++,
    pos: cloneVec3(at),
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    health: ENEMY_MAX_HEALTH,
    ai,
    targetId,
    stateTimer: 0,
    attackCooldown: 0,
    lastDistSq: Infinity,
    stuckTimer: 0,
    unstickTimer: 0,
    route: [],
    routeAt: 0,
    stemDir: -1,
    approach: false,
    seen: false,
  };
  world.state.enemies.set(hollow.id, hollow);
  return hollow;
}

export function horizontalDistSq(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/** Every Hollow, in id order (the map inserts in id order and never reorders). */
export function hollowsOf(world: World): EnemyState[] {
  const out: EnemyState[] = [];
  for (const e of world.state.enemies.values()) if (isHollow(e)) out.push(e);
  return out;
}

export function clearRoute(h: EnemyState): void {
  h.route = [];
  h.routeAt = 0;
  h.approach = false;
  h.stateTimer = 0;
  h.lastDistSq = Infinity;
}

/** The nearest Hollow other than `h` by horizontal distance, ties to the lower id; null when alone. */
export function nearestOtherHollow(world: World, h: EnemyState): EnemyState | null {
  let best: EnemyState | null = null;
  let bestSq = Infinity;
  for (const o of hollowsOf(world)) {
    if (o === h) continue;
    const sq = horizontalDistSq(o.pos, h.pos);
    if (sq < bestSq) {
      bestSq = sq;
      best = o;
    }
  }
  return best;
}

function speedOf(h: EnemyState): number {
  const base = h.ai === AiState.Crawl ? HOLLOW_CRAWL_SPEED : HOLLOW_HUNT_SPEED;
  return h.seen ? base * HOLLOW_LOOK_FACTOR : base;
}

/**
 * One movement step toward (tx, tz) at `speed`, through `stepMovement` with
 * the enemy hull, so the Hollow inherits sliding, step-up, ground following
 * and wading. The direction rides as a world-axis wish with yaw 0; `yaw`
 * itself is written only for the view. Above the walk the wish carries the
 * Sprint bit, since a wish longer than 1 is clamped inside `wishDirection`.
 *
 * Stuck handling is `ai.ts`'s: no progress on the squared distance for
 * STUCK_SECONDS starts a sidestep that holds until progress resumes.
 */
function walkToward(h: EnemyState, world: World, dt: number, tx: number, tz: number, speed: number): void {
  const dx = tx - h.pos.x;
  const dz = tz - h.pos.z;
  const distSq = dx * dx + dz * dz;
  const dist = Math.sqrt(distSq);
  if (dist < EPSILON) return;
  h.yaw = Math.atan2(dx, dz);

  if (distSq < h.lastDistSq - STUCK_EPSILON) h.stuckTimer = 0;
  else h.stuckTimer += dt;
  h.lastDistSq = distSq;
  if (h.stuckTimer > STUCK_SECONDS) h.unstickTimer = UNSTICK_SECONDS;

  let ux = dx / dist;
  let uz = dz / dist;
  if (h.unstickTimer > 0) {
    h.unstickTimer = Math.max(0, h.unstickTimer - dt);
    // A quarter turn, odd and even ids opposite ways, as the chaser does.
    const side = (h.id & 1) === 0 ? 1 : -1;
    const sx = side * uz;
    const sz = -side * ux;
    ux = sx;
    uz = sz;
  }

  const top = speed > WALK_SPEED ? SPRINT_SPEED : WALK_SPEED;
  const wish = speed / top;
  const result = stepMovement(
    { pos: h.pos, vel: h.vel, grounded: true },
    { seq: 0, moveX: ux * wish, moveZ: uz * wish, yaw: 0, pitch: 0, buttons: top === SPRINT_SPEED ? Button.Sprint : 0 },
    dt,
    world.boxes,
    ENEMY_HALF,
    world.waterLevel,
    world.ground,
  );
  h.pos = result.pos;
  h.vel = result.vel;
}

/** Walks the current route; true once every node has been reached. */
function followRoute(h: EnemyState, world: World, graph: TrailGraph, dt: number, speed: number): boolean {
  while (h.routeAt < h.route.length) {
    const node = graph.nodes[h.route[h.routeAt] as number] as TrailNode;
    if (horizontalDistSq(h.pos, node) <= HOLLOW_WAYPOINT_RADIUS * HOLLOW_WAYPOINT_RADIUS) {
      h.routeAt++;
      h.lastDistSq = Infinity;
      continue;
    }
    walkToward(h, world, dt, node.x, node.z, speed);
    return false;
  }
  return true;
}

/** The stem node nearest `h`, as an index into the chain. */
function nearestStemIndex(h: EnemyState, graph: TrailGraph, chain: number[]): number {
  let best = 0;
  let bestSq = Infinity;
  for (let i = 0; i < chain.length; i++) {
    const n = graph.nodes[chain[i] as number] as TrailNode;
    const sq = horizontalDistSq(h.pos, n);
    if (sq < bestSq) {
      bestSq = sq;
      best = i;
    }
  }
  return best;
}

/** The pendulum: at either end of the stem the direction flips and the chain is walked back. */
function crawl(h: EnemyState, world: World, graph: TrailGraph, dt: number): void {
  if (h.routeAt >= h.route.length) {
    const chain = stemNodes(graph);
    // A finished route means an end was reached: turn. An empty one is a
    // fresh start (birth, or a release), which keeps its direction.
    if (h.route.length > 0) h.stemDir = -h.stemDir;
    const k = nearestStemIndex(h, graph, chain);
    h.route = h.stemDir > 0 ? chain.slice(k) : chain.slice(0, k + 1).reverse();
    h.routeAt = 0;
    h.lastDistSq = Infinity;
  }
  followRoute(h, world, graph, dt, speedOf(h));
}

/**
 * Hunt and Merge share this: the graph to the node nearest the target, then
 * straight at it. Off the graph, losing sight of the target for
 * HOLLOW_LOST_SIGHT_S drops the approach and re-routes from wherever it is.
 */
function pursue(h: EnemyState, world: World, graph: TrailGraph, dt: number, target: Vec3): void {
  const speed = speedOf(h);
  if (!h.approach) {
    const targetNode = nearestTrailNode(graph, target.x, target.z);
    if (h.routeAt >= h.route.length || h.route[h.route.length - 1] !== targetNode) {
      // Seeded from the node it is already walking to, not the node nearest
      // its feet. In the first half of an edge the nearest node is the one
      // behind it, so rebuilding from there turns it round and throws away
      // the ground it covered — and a target whose nearest node flips every
      // tick (one crossing the perpendicular bisector of two nodes) would
      // rock it about a single node forever. From the node ahead, progress
      // stays monotone: at worst one edge of overshoot after a flip.
      const from =
        h.routeAt < h.route.length
          ? (h.route[h.routeAt] as number)
          : nearestTrailNode(graph, h.pos.x, h.pos.z);
      h.route = [...route(graph, from, targetNode)];
      h.routeAt = 0;
      h.lastDistSq = Infinity;
    }
    const near =
      horizontalDistSq(h.pos, target) <= HOLLOW_APPROACH_RANGE * HOLLOW_APPROACH_RANGE &&
      hasLineOfSight(h.pos, target, world.boxes, world.ground);
    if (near || followRoute(h, world, graph, dt, speed)) {
      h.approach = true;
      h.stateTimer = 0;
      h.lastDistSq = Infinity;
    }
    // The approach starts next tick: this one either walked the route or
    // just decided, and a Hollow moves once per tick.
    return;
  }
  if (hasLineOfSight(h.pos, target, world.boxes, world.ground)) {
    h.stateTimer = 0;
  } else {
    h.stateTimer += dt;
    if (h.stateTimer >= HOLLOW_LOST_SIGHT_S) {
      clearRoute(h);
      return;
    }
  }
  walkToward(h, world, dt, target.x, target.z, speed);
}

function stepHollow(h: EnemyState, world: World, graph: TrailGraph, dt: number): void {
  switch (h.ai) {
    case AiState.Crawl:
      crawl(h, world, graph, dt);
      return;
    case AiState.Hunt: {
      const target = world.state.players.get(h.targetId);
      if (target !== undefined) pursue(h, world, graph, dt, target.pos);
      return;
    }
    case AiState.Merge: {
      const other = nearestOtherHollow(world, h);
      if (other !== null) pursue(h, world, graph, dt, other.pos);
      return;
    }
    default:
      return;
  }
}

/** Every Hollow's movement for one tick. Host only; a no-op without a trail. */
export function stepHollows(world: World, dt: number): void {
  const graph = world.trail;
  if (graph === null) return;
  for (const h of hollowsOf(world)) stepHollow(h, world, graph, dt);
}
