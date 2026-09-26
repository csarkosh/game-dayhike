/**
 * The cut (docs/gameplay/2026-09-16-the-summit.md §5.3): the host's record of
 * the hidden guide route and the forks it has cut, and the three rules the
 * cut is made of — which branch a player arrived by (`triggerEdge`), which
 * branch stays open (`openBranch`), and where a closed branch's Hollow steps
 * out (`forkSpawn`). Host only, off the wire and outside the fingerprint,
 * like the Hollow's route: nothing here changes what a peer receives, only
 * which Hollows exist to be sent.
 *
 * A closed branch is a Hollow, not a wall. The rules never remove trail; they
 * decide where the Hollows stand, and they are pure — the record is the only
 * state, and the Chase tick's trigger (`stepCuts`) is the only thing that
 * writes it. The fork Hollow's own timing (how long it walks, how long it
 * stands) is hollow.ts's, with the summit Hollow's: this module depends on
 * that one, never the other way.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot; the one
 * random draw is the guide's, from the world RNG on the discovery tick.
 * Every choice among equals goes to the lower edge index.
 */
import type { PlayerState, Vec3 } from "./types.js";
import { nextRandom } from "./types.js";
import type { World } from "./world.js";
import type { TrailEdge, TrailGraph, TrailNode } from "./trail.js";
import { TRAIL_CORRIDOR_HALF, segmentDistance } from "./trail.js";
import { guideWalk, homeDistances, route } from "./trailRoute.js";
import { isOnCorridor } from "./containment.js";
import { horizontalDistSq, spawnForkHollow } from "./hollow.js";
import { ENEMY_HALF } from "./constants.js";

/** Metres from an uncut fork within which a living, unsafe player on one of its branches cuts it. */
export const FORK_CUT_RADIUS = 30;
/** Metres into a closed branch, along the bed, where its Hollow steps out. */
export const FORK_SPAWN_DIST = 12;
/** Metres a spawn keeps short of the branch's far node and of the road corridor. */
export const FORK_SPAWN_CLEAR = 1;
/** The least a spawn may stand from the fork: a branch with no room for that cannot close. */
export const FORK_SPAWN_MIN = 2;
/** Horizontal metres a spawn keeps from every living player. */
export const FORK_SPAWN_PLAYER_CLEAR = 2;
/** Near-ties among a stray's ways home, in metres, are broken toward the one that meets the guide soonest. */
export const GUIDE_REJOIN_SLACK = 60;
/** Metres between samples along a branch's bed when placing a spawn. */
const FORK_SPAWN_STEP = 0.25;

/**
 * Host-only: the guide, what has been cut, and which edges are closed. Off
 * the wire and outside the fingerprint (`World.cut`, world.ts).
 */
export type CutRecord = {
  /** Node path crest → pad (`guideWalk`), drawn on the discovery tick; no node twice. */
  guide: readonly number[];
  /**
   * Fork node → the neighbour node its open branch leads to, or -1 for a fork
   * cut with no open branch: one standing on the corridor, or one where
   * nothing but the arrival reaches the pad. A fork recorded here is judged
   * once, whatever was closed.
   */
  cuts: Map<number, number>;
  /** Edge indices closed so far: the residual graph is every other edge. */
  closed: Set<number>;
};

/** Draws the guide from the world RNG. Called once, on the flip. A world with no trail has no guide. */
export function drawGuide(world: World): CutRecord {
  const graph = world.trail;
  const guide = graph === null ? [] : guideWalk(graph, () => nextRandom(world.state)).path;
  return { guide, cuts: new Map(), closed: new Set() };
}

function edgeLength(graph: TrailGraph, e: TrailEdge): number {
  const a = graph.nodes[e.a] as TrailNode, b = graph.nodes[e.b] as TrailNode;
  const dx = b.x - a.x, dz = b.z - a.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function joins(e: TrailEdge, u: number, v: number): boolean {
  return (e.a === u && e.b === v) || (e.a === v && e.b === u);
}

/**
 * The incident edge of `fork` a player at (x, z) is on: the nearest by
 * segmentDistance, ties to the lower edge index, or -1 when the nearest is
 * farther than TRAIL_CORRIDOR_HALF — the player is near the fork but on
 * trail that is not one of its branches.
 */
export function triggerEdge(graph: TrailGraph, fork: number, x: number, z: number): number {
  let best = -1, bestD = Infinity;
  for (let ei = 0; ei < graph.edges.length; ei++) {
    const e = graph.edges[ei] as TrailEdge;
    if (e.a !== fork && e.b !== fork) continue;
    const a = graph.nodes[e.a] as TrailNode, b = graph.nodes[e.b] as TrailNode;
    const d = segmentDistance(a.x, a.z, b.x, b.z, x, z);
    if (d < bestD) { bestD = d; best = ei; }
  }
  return bestD > TRAIL_CORRIDOR_HALF ? -1 : best;
}

/** Metres along `path` from its first node to the first node on the guide; Infinity when the path is empty or meets none. */
function metresToGuide(graph: TrailGraph, path: readonly number[], onGuide: ReadonlySet<number>): number {
  let metres = 0;
  for (let i = 0; i < path.length; i++) {
    const n = path[i] as number;
    if (onGuide.has(n)) return metres;
    if (i + 1 === path.length) break;
    const a = graph.nodes[n] as TrailNode, b = graph.nodes[path[i + 1] as number] as TrailNode;
    const dx = b.x - a.x, dz = b.z - a.z;
    metres += Math.sqrt(dx * dx + dz * dz);
  }
  return Infinity;
}

/** The edges not closed in `record`, less those incident to `drop` (none when -1). */
function residualEdges(graph: TrailGraph, record: CutRecord, drop: number): TrailEdge[] {
  const out: TrailEdge[] = [];
  for (let ei = 0; ei < graph.edges.length; ei++) {
    if (record.closed.has(ei)) continue;
    const e = graph.edges[ei] as TrailEdge;
    if (e.a === drop || e.b === drop) continue;
    out.push(e);
  }
  return out;
}

/**
 * The stray's rule on one residual graph: of the incident edges of `fork`
 * that are neither the arrival nor closed, the cheapest way home (the edge,
 * then the shortest route from its far node on `residual`); among near-ties
 * within GUIDE_REJOIN_SLACK the one whose way home meets the guide in the
 * fewest metres from the fork, then the cheaper, then the lower edge index.
 * -1 when no candidate's far node reaches the pad on `residual`.
 */
function bestBranch(graph: TrailGraph, record: CutRecord, fork: number, arrival: number, residual: TrailEdge[]): number {
  const dist = homeDistances(graph.nodes, residual);
  const candidates: Array<{ ei: number; far: number; cost: number; len: number }> = [];
  let cheapest = Infinity;
  for (let ei = 0; ei < graph.edges.length; ei++) {
    if (ei === arrival || record.closed.has(ei)) continue;
    const e = graph.edges[ei] as TrailEdge;
    const far = e.a === fork ? e.b : e.b === fork ? e.a : -1;
    if (far === -1) continue;
    const home = dist[far] as number;
    if (home === Infinity) continue;
    const len = edgeLength(graph, e);
    const cost = len + home;
    candidates.push({ ei, far, cost, len });
    if (cost < cheapest) cheapest = cost;
  }
  if (candidates.length === 0) return -1;

  // The residual graph as a graph of its own, so `route` can walk it; a fresh
  // object, so its memo never mixes with the full graph's.
  const sub: TrailGraph = { ...graph, edges: residual };
  const onGuide = new Set(record.guide);
  let best: { ei: number; cost: number; rejoin: number } | null = null;
  for (const c of candidates) {
    if (c.cost > cheapest + GUIDE_REJOIN_SLACK) continue;
    const rejoin = c.len + metresToGuide(sub, route(sub, c.far, 0), onGuide);
    if (best === null || rejoin < best.rejoin || (rejoin === best.rejoin && c.cost < best.cost)) {
      best = { ei: c.ei, cost: c.cost, rejoin };
    }
  }
  return best === null ? -1 : best.ei;
}

/**
 * Which incident edge of `fork` stays open, given the edge the player
 * arrived by, or -1 when no other open edge reaches the pad on the residual
 * graph. Never the arrival, never an edge already closed.
 *
 * On the guide, arriving by the guide's edge into the fork, the open edge is
 * the guide's edge out of it (still open — an edge joining two forks can have
 * been closed at the other one, and then the fork is judged like a stray's).
 * Otherwise the candidate branches are costed on the residual graph with the
 * fork's own edges removed: a branch's way home must not come back through
 * the fork it leaves, or "the open branch reaches the pad" would be true of
 * a branch that leads nowhere but back to the Hollows just placed. When that
 * leaves nothing — a straggler still climbing has reached a fork the whole
 * upper trail hangs on, and every branch's way home is back through it and
 * down the arrival — the branches are costed once more on the residual with
 * the fork's edges kept (the arrival is never closed, so that way home is
 * real), skipping any branch that is itself a dead end: the crest's, on a
 * finished trail, which is nobody's way home. Only then -1.
 */
export function openBranch(graph: TrailGraph, record: CutRecord, fork: number, arrival: number): number {
  const guide = record.guide;
  const arrivalEdge = graph.edges[arrival];
  const i = guide.indexOf(fork);
  if (i > 0 && i + 1 < guide.length && arrivalEdge !== undefined && joins(arrivalEdge, guide[i - 1] as number, fork)) {
    for (let ei = 0; ei < graph.edges.length; ei++) {
      if (ei === arrival || record.closed.has(ei)) continue;
      if (joins(graph.edges[ei] as TrailEdge, fork, guide[i + 1] as number)) return ei;
    }
  }
  const beyond = bestBranch(graph, record, fork, arrival, residualEdges(graph, record, fork));
  if (beyond !== -1) return beyond;
  // The fallback: a dead-end branch is one whose far node cannot reach the
  // pad without the branch itself, and it is closed for the costing rather
  // than in the record, so it stays a candidate for a Hollow.
  const kept = residualEdges(graph, record, -1);
  const deadEnds = new Set(record.closed);
  for (let ei = 0; ei < graph.edges.length; ei++) {
    if (ei === arrival || record.closed.has(ei)) continue;
    const e = graph.edges[ei] as TrailEdge;
    const far = e.a === fork ? e.b : e.b === fork ? e.a : -1;
    if (far === -1) continue;
    const without = kept.filter((k) => k !== e);
    if ((homeDistances(graph.nodes, without)[far] as number) === Infinity) deadEnds.add(ei);
  }
  const judged: CutRecord = { guide, cuts: record.cuts, closed: deadEnds };
  return bestBranch(graph, judged, fork, arrival, residualEdges(graph, judged, -1));
}

/** Whether a living player stands within FORK_SPAWN_PLAYER_CLEAR (horizontal) of (x, z). */
function onAPlayer(world: World, x: number, z: number): boolean {
  const reach = FORK_SPAWN_PLAYER_CLEAR * FORK_SPAWN_PLAYER_CLEAR;
  for (const p of world.state.players.values()) {
    if (p.health <= 0) continue;
    if (horizontalDistSq(p.pos, { x, z }) < reach) return true;
  }
  return false;
}

/**
 * Where a Hollow steps out of the closed edge `edge` leaving `fork`, or null
 * when no point on the branch is off the corridor, at least
 * FORK_SPAWN_PLAYER_CLEAR from every living player, and at least
 * FORK_SPAWN_MIN from the fork: such a branch cannot close. `y` is the
 * Hollow's centre.
 *
 * The bed is straight in XZ between graph nodes and the node's x, z is the
 * centreline. The spawn stands FORK_SPAWN_DIST in, or FORK_SPAWN_CLEAR short
 * of the far node (which may be another fork) or of the corridor when either
 * comes sooner; a living player under it moves it on along the bed, one
 * sample at a time, within the same limits. The corridor is looked for along
 * the whole branch, not only up to the first candidate, and the cap is a
 * sample too: every point the spawn can stand on is one the scan tested, so
 * a spawn a player pushed along stays a metre clear of safe ground as well.
 */
export function forkSpawn(world: World, fork: number, edge: number): Vec3 | null {
  const graph = world.trail;
  if (graph === null) return null;
  const e = graph.edges[edge];
  if (e === undefined) return null;
  const far = e.a === fork ? e.b : e.b === fork ? e.a : -1;
  if (far === -1) return null;
  const a = graph.nodes[fork] as TrailNode, b = graph.nodes[far] as TrailNode;
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len <= 0) return null;
  const ux = dx / len, uz = dz / len;

  // How far in the branch admits a spawn at all: short of its end, and short
  // of the first sample that stands on safe ground. The end is rounded down
  // to a sample (exact: the step is a power of two), so the cap is a point
  // the scan below has tested.
  let limit = Math.floor((len - FORK_SPAWN_CLEAR) / FORK_SPAWN_STEP) * FORK_SPAWN_STEP;
  for (let d = 0; d <= len; d += FORK_SPAWN_STEP) {
    if (isOnCorridor(world, a.x + ux * d, a.z + uz * d)) { limit = Math.min(limit, d - FORK_SPAWN_CLEAR); break; }
  }
  if (limit < FORK_SPAWN_MIN) return null;
  let at = Math.min(FORK_SPAWN_DIST, limit);
  while (at <= limit && onAPlayer(world, a.x + ux * at, a.z + uz * at)) at += FORK_SPAWN_STEP;
  if (at > limit) return null;

  const x = a.x + ux * at, z = a.z + uz * at;
  const bed = world.ground !== null ? world.ground.heightAt(x, z) : a.h + (b.h - a.h) * (at / len);
  return { x, y: bed + ENEMY_HALF.y, z };
}

/** The living, unsafe player nearest `fork` within FORK_CUT_RADIUS and on one of its branches, ties to the lower id; null when none. */
function triggerOf(world: World, graph: TrailGraph, fork: number): { player: PlayerState; arrival: number } | null {
  const node = graph.nodes[fork] as TrailNode;
  const reach = FORK_CUT_RADIUS * FORK_CUT_RADIUS;
  let best: { player: PlayerState; arrival: number } | null = null;
  let bestSq = Infinity;
  for (const p of world.state.players.values()) {
    if (p.health <= 0 || p.safe) continue;
    const sq = horizontalDistSq(p.pos, node);
    if (sq > reach) continue;
    if (best !== null && (sq > bestSq || (sq === bestSq && p.id > best.player.id))) continue;
    const arrival = triggerEdge(graph, fork, p.pos.x, p.pos.z);
    if (arrival === -1) continue;
    best = { player: p, arrival };
    bestSq = sq;
  }
  return best;
}

/**
 * The cut, host only, each Chase tick (summit.ts): every uncut fork is
 * judged once, the first tick a living, unsafe player is within
 * FORK_CUT_RADIUS of it and on one of its branches (`triggerEdge`). The
 * nearest such player (ties to the lower id) is the trigger; their arrival
 * edge is never closed, one more branch stays open (`openBranch`), and every
 * other branch not already closed closes with a Hollow stepping out of it
 * (`forkSpawn`, `spawnForkHollow`) that walks to the fork and hunts the
 * trigger. A fork on the corridor — safe ground, where nobody is hunted —
 * or one with nothing to close is recorded with -1 and closes nothing; a
 * branch with no room for a Hollow stays open and is not counted closed.
 *
 * Forks are judged in ascending node order, so two reached on the same tick
 * resolve the same way on every machine, and the second sees the first's
 * closures in its residual graph. The Hollows spawn here, at the tail of the
 * tick, and take their first step on the next.
 */
export function stepCuts(world: World): void {
  const graph = world.trail;
  const record = world.cut;
  if (graph === null || record === null) return;
  for (const fork of graph.forks) {
    if (record.cuts.has(fork)) continue;
    const trigger = triggerOf(world, graph, fork);
    if (trigger === null) continue;
    const node = graph.nodes[fork] as TrailNode;
    if (isOnCorridor(world, node.x, node.z)) {
      record.cuts.set(fork, -1);
      continue;
    }
    const open = openBranch(graph, record, fork, trigger.arrival);
    if (open === -1) {
      record.cuts.set(fork, -1);
      continue;
    }
    const openEdge = graph.edges[open] as TrailEdge;
    record.cuts.set(fork, openEdge.a === fork ? openEdge.b : openEdge.a);
    const bed = world.ground !== null ? world.ground.heightAt(node.x, node.z) : node.h;
    const mouth: Vec3 = { x: node.x, y: bed + ENEMY_HALF.y, z: node.z };
    for (let ei = 0; ei < graph.edges.length; ei++) {
      if (ei === trigger.arrival || ei === open || record.closed.has(ei)) continue;
      const e = graph.edges[ei] as TrailEdge;
      if (e.a !== fork && e.b !== fork) continue;
      const at = forkSpawn(world, fork, ei);
      if (at === null) continue;
      spawnForkHollow(world, at, mouth, trigger.player.id);
      record.closed.add(ei);
    }
  }
}
