/**
 * The Hollow (docs/gameplay/2026-09-16-the-summit.md §5): the figure that
 * steps out at the crest when the body is found and hunts the party down the
 * mountain. It cannot be killed. Contact kills, and being looked at slows it
 * at the price of the looker's stare.
 *
 * A Hollow is an `EnemyState` whose `ai` is Hunt, Emerge or Stand, so the
 * snapshot's enemy channel carries it as it carries any enemy. Everything
 * here runs inside `tickWorld`'s authoritative branch: host-only, never
 * replayed on a client. That is why `Math.atan2` for the facing is allowed
 * (architecture.test.ts) — an engine difference cannot diverge two peers.
 * The walk itself passes its direction as a world-axis wish through
 * `stepMovement` with yaw 0, so movement needs no trig at all.
 */
import type { EnemyState, PlayerState, Vec3 } from "./types.js";
import { AiState, Button, Outcome, cloneVec3 } from "./types.js";
import type { World } from "./world.js";
import type { TrailGraph, TrailNode } from "./trail.js";
import { nearestTrailNode } from "./trail.js";
import { route } from "./trailRoute.js";
import { stepMovement } from "./movement.js";
import { aimDirection } from "./view.js";
import { STUCK_EPSILON, STUCK_SECONDS, UNSTICK_SECONDS, hasLineOfSight } from "./ai.js";
import { isOnCorridor, roadOffset } from "./containment.js";
import { ROAD_CORRIDOR_HALF } from "./road.js";
import {
  ENEMY_HALF,
  ENEMY_MAX_HEALTH,
  EPSILON,
  PLAYER_EYE_OFFSET,
  PLAYER_HALF,
  SIM_TICK_HZ,
  SPRINT_SPEED,
  WALK_SPEED,
} from "./constants.js";

/** Hunting, m/s: a touch under SPRINT_SPEED 7, so walking, stopping or turning back is what closes the gap. */
export const HOLLOW_HUNT_SPEED = 6.3;
/** Its speed while a living player has it in view: a glance back buys distance and costs the screen. */
export const HOLLOW_LOOK_FACTOR = 0.6;
/** Seconds it stands still at the crest as it steps out, before the hunt. */
export const SUMMIT_REVEAL_S = 2;
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
/** Horizontal metres within which a route node counts as reached. */
export const HOLLOW_WAYPOINT_RADIUS = 1.5;
/** Within this of its target, with line of sight, it leaves the graph. */
export const HOLLOW_APPROACH_RANGE = 25;
/** Off the graph and blind to its target this long, it re-routes. */
export const HOLLOW_LOST_SIGHT_S = 3;
/** The placeholder's height, metres (entityViews.ts). */
export const HOLLOW_HEIGHT = 2.6;
/**
 * Metres past the corridor's edge a Hollow inside it walks for. The margin
 * keeps the destination ahead of it for as long as it is inside: aimed at the
 * line itself, a Hollow a hair short of it would have nowhere left to walk
 * and report a move without making one (`walkToward`).
 */
export const HOLLOW_EXIT_MARGIN = 1;

export function isHollowState(ai: AiState): boolean {
  return ai === AiState.Hunt || ai === AiState.Emerge || ai === AiState.Stand;
}

export function isHollow(e: EnemyState): boolean {
  return isHollowState(e.ai);
}

/**
 * Spawns a Hollow at `at` in Emerge for `revealS` seconds, then it hunts `targetId`.
 *
 * `at` is meant to be off the road corridor, which is the party's safe ground;
 * the precondition degrades rather than breaks, though — a Hollow spawned on
 * the corridor walks straight out to the nearest edge before it takes up its
 * route (`walkToward`), rather than freezing.
 */
export function spawnHollow(world: World, at: Vec3, targetId: number, revealS: number): EnemyState {
  const hollow: EnemyState = {
    id: world.state.nextEntityId++,
    pos: cloneVec3(at),
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    health: ENEMY_MAX_HEALTH,
    ai: revealS > 0 ? AiState.Emerge : AiState.Hunt,
    targetId,
    stateTimer: revealS,
    attackCooldown: 0,
    lastDistSq: Infinity,
    stuckTimer: 0,
    unstickTimer: 0,
    route: [],
    routeAt: 0,
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

/** The living, unsafe player nearest `pos`, ties to the lower id; null when there is none. */
export function nearestPrey(world: World, pos: Vec3): PlayerState | null {
  let best: PlayerState | null = null;
  let bestSq = Infinity;
  for (const p of world.state.players.values()) {
    if (p.health <= 0 || p.safe) continue;
    const sq = horizontalDistSq(p.pos, pos);
    if (sq < bestSq || (sq === bestSq && best !== null && p.id < best.id)) {
      bestSq = sq;
      best = p;
    }
  }
  return best;
}

/** The facing toward (tx, tz), for a Hollow that is not walking. Host-only, so atan2 is allowed. */
function faceToward(h: EnemyState, tx: number, tz: number): void {
  const dx = tx - h.pos.x;
  const dz = tz - h.pos.z;
  if (dx * dx + dz * dz > EPSILON * EPSILON) h.yaw = Math.atan2(dx, dz);
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

function speedOf(h: EnemyState): number {
  const base = HOLLOW_HUNT_SPEED;
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
 *
 * THE HOLLOW STAYS IN THE WOODS. The road corridor is the party's safe
 * ground, and the rule has two halves, split on where the Hollow stands
 * BEFORE the step:
 *
 * - Outside, a step that would end on the corridor is refused, and it stands
 *   at the treeline facing the pad. Refusing the step rather than clamping the
 *   position keeps it on ground it could have walked to, and the stuck
 *   handling then slides it along the treeline instead of pressing into it.
 *
 * - Inside — placed there, or spawned on the trail's lower stretch, which runs
 *   inside the corridor on some seeds — it ignores where it was asked to go
 *   and walks straight across to its own side's edge, the point at its own z
 *   (not the nearest point of the line, which on a skewed road is off along
 *   it), and HOLLOW_EXIT_MARGIN past it, so the destination stays ahead of it
 *   for as long as it is inside, taking every step it gets. Its road offset
 *   then grows by exactly the ground it covers, so the walk cannot stall.
 *   Its route waits (`followRoute`), and the hunt resumes from wherever it
 *   comes out. It cannot follow the route out, because a route into the woods
 *   can start at the trailhead, which is deeper inside: every step toward it
 *   would be refused, the sidestep the stuck handling offers runs along the
 *   road and never out of it, and a Hollow refused every step never reaches
 *   `stepMovement` at all — not even gravity would move it.
 *
 *   The edge it heads for sits at its own z, so it moves along with it, and a
 *   sidestep along the road can never read as progress toward it. Inside,
 *   therefore, the sidestep is timed rather than held: UNSTICK_SECONDS of
 *   strafe, then straight for the edge again. Boulders and cliffs are kept
 *   off the corridor, so the only things to be pinned on are the three road
 *   props, the widest being the car, 4.6 m along the road; one strafe from a
 *   standstill covers about 4.1 m, and the side never changes, so the second
 *   clears it where the first did not.
 *
 * Returns whether it moved (or had nowhere to move to): false is a step
 * refused at the treeline, which `followRoute` reads.
 */
function walkToward(h: EnemyState, world: World, dt: number, tx: number, tz: number, speed: number): boolean {
  const u = roadOffset(world, h.pos.x, h.pos.z);
  const inside = u !== null && (u < 0 ? -u : u) < ROAD_CORRIDOR_HALF;
  if (inside) {
    // The edge on its own side; on the centreline itself, the forest's (+x).
    const side = u < 0 ? -1 : 1;
    tx = h.pos.x - u + side * (ROAD_CORRIDOR_HALF + HOLLOW_EXIT_MARGIN);
    tz = h.pos.z;
  }

  const dx = tx - h.pos.x;
  const dz = tz - h.pos.z;
  const distSq = dx * dx + dz * dz;
  const dist = Math.sqrt(distSq);
  if (dist < EPSILON) return true;
  h.yaw = Math.atan2(dx, dz);

  if (distSq < h.lastDistSq - STUCK_EPSILON) h.stuckTimer = 0;
  else h.stuckTimer += dt;
  h.lastDistSq = distSq;
  if (h.stuckTimer > STUCK_SECONDS) {
    h.unstickTimer = UNSTICK_SECONDS;
    if (inside) h.stuckTimer = 0;
  }

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
  // The treeline: from outside, a step onto the corridor is refused. Safety is
  // the corridor, not the car.
  if (!inside && isOnCorridor(world, result.pos.x, result.pos.z)) {
    h.vel = { x: 0, y: 0, z: 0 };
    const th = world.trail?.trailhead;
    if (th !== undefined) faceToward(h, th.x, th.z);
    return false;
  }
  h.pos = result.pos;
  h.vel = result.vel;
  return true;
}

/**
 * Walks the current route; true once every node has been reached.
 *
 * A node on the road corridor is passed, not reached, once the treeline
 * refuses a step toward it and the route goes on: the trailhead is inside the
 * corridor (TRAILHEAD_U is 9), and on some seeds so is the trail's lower
 * stretch, and a Hollow that came out of the corridor by the pad, or was
 * routed from the node nearest its feet, can hold a route into the woods that
 * starts there. Walking that leg would have it refused at the treeline for
 * good. Both conditions are needed. A node's merely being on the corridor
 * does not pass it, because the leg toward such a node is usually the trail
 * itself, and the trail is what brings the Hollow to the treeline where its
 * prey stands; leaving it early for a straight line to the node beyond would
 * trade the trail for the forest. And a refusal alone does not pass a node,
 * because the treeline also refuses a grazing step — a Hollow within one
 * step of the edge whose heading toward a node OUTSIDE the corridor loses a
 * little road offset, off a leg that hugs the edge, a box slide or the road's
 * slope — and that node is still the one to walk for: the stuck handling
 * slides it along the treeline until the leg clears, as it always has. The
 * last node it stands for, at the treeline, facing the pad.
 */
function followRoute(h: EnemyState, world: World, graph: TrailGraph, dt: number, speed: number): boolean {
  while (h.routeAt < h.route.length) {
    const node = graph.nodes[h.route[h.routeAt] as number] as TrailNode;
    if (horizontalDistSq(h.pos, node) <= HOLLOW_WAYPOINT_RADIUS * HOLLOW_WAYPOINT_RADIUS) {
      h.routeAt++;
      h.lastDistSq = Infinity;
      continue;
    }
    const refused = !walkToward(h, world, dt, node.x, node.z, speed);
    if (!refused || h.routeAt + 1 >= h.route.length || !isOnCorridor(world, node.x, node.z)) return false;
    // Refused toward a node on the corridor, with the route going on: the
    // next node, from here, this tick — a refused step moved nothing, so the
    // one move a Hollow makes per tick is still to come.
    h.routeAt++;
    h.lastDistSq = Infinity;
  }
  return true;
}

/**
 * The hunt's walk: the graph to the node nearest the target, then straight at
 * it. Off the graph, losing sight of the target for HOLLOW_LOST_SIGHT_S drops
 * the approach and re-routes from wherever it is.
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
    case AiState.Emerge: {
      // The reveal: it steps out and looks at whoever found the body, giving
      // the party SUMMIT_REVEAL_S to see it before it moves at all.
      const target = world.state.players.get(h.targetId);
      if (target !== undefined) faceToward(h, target.pos.x, target.pos.z);
      h.stateTimer -= dt;
      if (h.stateTimer <= 0) {
        h.ai = AiState.Hunt;
        clearRoute(h);
      }
      return;
    }
    case AiState.Hunt: {
      const target = world.state.players.get(h.targetId);
      if (target !== undefined) pursue(h, world, graph, dt, target.pos);
      return;
    }
    case AiState.Stand: {
      // Nobody left to hunt: it waits where it is, facing the pad, because
      // that is where the next living player will come from.
      const th = graph.trailhead;
      faceToward(h, th.x, th.z);
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

/**
 * The look test: the Hollow's centre within HOLLOW_LOOK_COS of the player's
 * aim ray, within HOLLOW_LOOK_RANGE of the eye, and nothing in between.
 */
export function playerSees(player: PlayerState, hollow: EnemyState, world: World): boolean {
  const eye: Vec3 = { x: player.pos.x, y: player.pos.y + PLAYER_EYE_OFFSET, z: player.pos.z };
  const dx = hollow.pos.x - eye.x;
  const dy = hollow.pos.y - eye.y;
  const dz = hollow.pos.z - eye.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < EPSILON || dist > HOLLOW_LOOK_RANGE) return false;
  const dir = aimDirection(player.yaw, player.pitch);
  if ((dx * dir.x + dy * dir.y + dz * dir.z) / dist < HOLLOW_LOOK_COS) return false;
  return hasLineOfSight(eye, hollow.pos, world.boxes, world.ground);
}

/**
 * The per-tick rules, host only, after every Hollow has moved: contact
 * kills, and the look test, which slows a seen Hollow next tick and fills or
 * empties each player's stare. The loss is `updateLoss`, which every world
 * runs, Hollow or not.
 */
export function updateHollows(world: World): void {
  if (world.trail === null) return;
  const state = world.state;

  // Contact.
  const reach = PLAYER_HALF.x + ENEMY_HALF.x + HOLLOW_CONTACT_MARGIN;
  const tall = PLAYER_HALF.y + ENEMY_HALF.y;
  for (const h of hollowsOf(world)) {
    for (const p of state.players.values()) {
      if (p.health <= 0 || p.safe) continue;
      const dy = p.pos.y - h.pos.y;
      if (horizontalDistSq(p.pos, h.pos) <= reach * reach && Math.abs(dy) <= tall) p.health = 0;
    }
  }

  // Looking and the stare.
  const all = hollowsOf(world);
  for (const h of all) h.seen = false;
  const fill = 1 / (HOLLOW_STARE_FILL_S * SIM_TICK_HZ);
  const empty = 1 / (HOLLOW_STARE_EMPTY_S * SIM_TICK_HZ);
  for (const p of state.players.values()) {
    if (p.health <= 0) continue;
    let sees = false;
    for (const h of all) {
      if (playerSees(p, h, world)) {
        h.seen = true;
        sees = true;
      }
    }
    p.stare = sees ? Math.min(1, p.stare + fill) : Math.max(0, p.stare - empty);
    if (p.stare >= 1) p.health = 0;
  }

  // Prey: a hunting Hollow whose target is dead, gone or safe takes the
  // nearest living, unsafe player, or stands; a standing one takes the
  // first prey that appears. A Hollow never merges and never leaves: the
  // pack only grows (summit.ts spawns; S3 adds the forks).
  for (const h of all) {
    if (h.ai === AiState.Emerge) continue;
    const target = state.players.get(h.targetId);
    const lost = target === undefined || target.health <= 0 || target.safe;
    if (h.ai === AiState.Hunt && !lost) continue;
    const prey = nearestPrey(world, h.pos);
    if (prey === null) {
      if (h.ai !== AiState.Stand) {
        h.ai = AiState.Stand;
        h.targetId = 0;
        clearRoute(h);
      }
      continue;
    }
    if (h.ai !== AiState.Hunt || h.targetId !== prey.id) {
      h.ai = AiState.Hunt;
      h.targetId = prey.id;
      clearRoute(h);
    }
  }
}

/**
 * The loss: a match that had players and has no living one is over. Death is
 * permanent on every level, so this runs on every world — the sandbox, where
 * no Hollow walks, ends the same way the forest does.
 */
export function updateLoss(world: World): void {
  const state = world.state;
  if (state.outcome !== Outcome.Playing || state.players.size === 0) return;
  for (const p of state.players.values()) if (p.health > 0) return;
  state.outcome = Outcome.Lost;
}
