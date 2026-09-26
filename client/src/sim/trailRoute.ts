/**
 * Routes on the trail graph, for the Hollow (hollow.ts): the stem as a node
 * chain, and the shortest node path between any two nodes. The graph never
 * changes for a world, so paths are memoised per graph.
 *
 * sim/ determinism rules: no trig, no Math.pow; `Math.sqrt` for lengths.
 */
import type { TrailEdge, TrailGraph, TrailNode } from "./trail.js";

/** The stem as nodes, pad first (node 0), crest last. */
export function stemNodes(graph: TrailGraph): number[] {
  const chain: number[] = [0];
  let at = 0;
  for (const ei of graph.stem) {
    const e = graph.edges[ei] as TrailEdge;
    at = e.a === at ? e.b : e.a;
    chain.push(at);
  }
  return chain;
}

/**
 * The Dijkstra core shared by `route` and `homeDistances`: settles the
 * lowest-index node first among equal distances, and stops as soon as
 * `stopAt` (default: none) is settled — so `route`'s early exit, its
 * memoised results and its tie-breaking are all bit-identical to before this
 * was factored out.
 */
function dijkstraFrom(
  nodes: readonly TrailNode[], edges: readonly TrailEdge[], from: number, stopAt = -1,
): { dist: number[]; prev: number[] } {
  const n = nodes.length;
  const dist: number[] = new Array<number>(n).fill(Infinity);
  const prev: number[] = new Array<number>(n).fill(-1);
  const done: boolean[] = new Array<boolean>(n).fill(false);
  if (n === 0) return { dist, prev };
  dist[from] = 0;
  for (let round = 0; round < n; round++) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (done[i] || (dist[i] as number) === Infinity) continue;
      if (u === -1 || (dist[i] as number) < (dist[u] as number)) u = i;
    }
    if (u === -1 || u === stopAt) break;
    done[u] = true;
    for (const e of edges) {
      const v = e.a === u ? e.b : e.b === u ? e.a : -1;
      if (v === -1 || done[v]) continue;
      const a = nodes[e.a] as TrailNode, b = nodes[e.b] as TrailNode;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = (dist[u] as number) + Math.sqrt(dx * dx + dz * dz);
      if (d < (dist[v] as number)) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  return { dist, prev };
}

const memo = new WeakMap<TrailGraph, Map<number, readonly number[]>>();

/**
 * The shortest node path from `from` to `to`, both inclusive: `[from]` when
 * they are the same node, `[]` when `to` cannot be reached. Dijkstra over
 * edge lengths; among equal distances the lower node index is settled first
 * and a later equal path never replaces an earlier one, so ties resolve
 * toward the lower index on every machine.
 */
export function route(graph: TrailGraph, from: number, to: number): readonly number[] {
  let table = memo.get(graph);
  if (table === undefined) {
    table = new Map();
    memo.set(graph, table);
  }
  const key = from * 65536 + to;
  const hit = table.get(key);
  if (hit !== undefined) return hit;

  const { dist, prev } = dijkstraFrom(graph.nodes, graph.edges, from, to);

  const path: number[] = [];
  if ((dist[to] as number) < Infinity) {
    for (let at = to; at !== -1; at = prev[at] as number) path.push(at);
    path.reverse();
  }
  const out: readonly number[] = Object.freeze(path);
  table.set(key, out);
  return out;
}

/**
 * Where (x, z) stands along the stem: the nearest point on the chain, as
 * progress from the crest (0) to the pad (1) by arc length. A point past
 * either end clamps to that end. 0 for a degenerate stem — one with no
 * length, which reads as the crest. The escalation reads this for the
 * party's climb (`game/escalation.ts`), which takes 1 minus it: the light
 * goes as the party nears the crest.
 */
export function stemProgress(graph: TrailGraph, x: number, z: number): number {
  const chain = stemNodes(graph);
  let arc = 0;
  let bestSq = Infinity;
  let bestArc = 0;
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = graph.nodes[chain[i] as number] as TrailNode;
    const b = graph.nodes[chain[i + 1] as number] as TrailNode;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    let t = 0;
    if (len > 0) {
      t = ((x - a.x) * dx + (z - a.z) * dz) / (len * len);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
    }
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const sq = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (sq < bestSq) {
      bestSq = sq;
      bestArc = arc + len * t;
    }
    arc += len;
  }
  return arc > 0 ? 1 - bestArc / arc : 0;
}

/**
 * The shortest trail distance from every node to the pad (node 0), by arc
 * length: Dijkstra from the pad over every edge. Infinity for a node no edge
 * chain reaches. The same settle order as `route` (lowest index among equal
 * distances), so it is bit-identical on every machine.
 */
export function homeDistances(nodes: readonly TrailNode[], edges: readonly TrailEdge[]): number[] {
  return dijkstraFrom(nodes, edges, 0).dist;
}

/** Every node of degree ≥ 3, ascending: the forks the cut rule works on. */
export function forksOf(nodeCount: number, edges: readonly TrailEdge[]): number[] {
  const degree = new Array<number>(nodeCount).fill(0);
  for (const e of edges) {
    degree[e.a] = (degree[e.a] as number) + 1;
    degree[e.b] = (degree[e.b] as number) + 1;
  }
  const out: number[] = [];
  for (let n = 0; n < nodeCount; n++) if ((degree[n] as number) >= 3) out.push(n);
  return out;
}

/** The guide's length band, as multiples of `shortestHome`, and how many walks to try. */
export const GUIDE_MIN = 1.5;
export const GUIDE_MAX = 2.5;
export const GUIDE_TRIES = 64;

/** A node path's arc length. */
export function pathLength(graph: TrailGraph, path: readonly number[]): number {
  let len = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = graph.nodes[path[i] as number] as TrailNode, b = graph.nodes[path[i + 1] as number] as TrailNode;
    const dx = b.x - a.x, dz = b.z - a.z;
    len += Math.sqrt(dx * dx + dz * dz);
  }
  return len;
}

/** True if `from` reaches node 0 without using any edge index in `used` (DFS). */
function reachesPad(graph: TrailGraph, from: number, used: ReadonlySet<number>): boolean {
  if (from === 0) return true;
  const seen = new Set<number>([from]);
  const stack = [from];
  while (stack.length > 0) {
    const n = stack.pop() as number;
    for (let ei = 0; ei < graph.edges.length; ei++) {
      if (used.has(ei)) continue;
      const e = graph.edges[ei] as TrailEdge;
      const m = e.a === n ? e.b : e.b === n ? e.a : -1;
      if (m === -1 || seen.has(m)) continue;
      if (m === 0) return true;
      seen.add(m);
      stack.push(m);
    }
  }
  return false;
}

/**
 * The guide: a seeded random walk crest → pad that never repeats an edge and
 * never stands on a node twice, choosing at each node uniformly among the
 * unused edges whose far node is not yet on the walk and can still reach the
 * pad without a repeated edge, abandoned once it exceeds `max` × shortestHome
 * or runs out of such edges. The node rule is the cut's (cut.ts): a fork the
 * guide passed twice would have two edges into it and two out. The first
 * walk whose length lands in [min, max] × shortestHome is returned with
 * `inBand: true`; otherwise the longest walk found under the cap; otherwise
 * the shortest path (the 227-seed sweep shows the shortest-path case does not
 * arise). Deterministic in `rand` (the host passes `() => nextRandom(state)`).
 */
export function guideWalk(
  graph: TrailGraph, rand: () => number, min = GUIDE_MIN, max = GUIDE_MAX, tries = GUIDE_TRIES,
): { path: readonly number[]; length: number; inBand: boolean } {
  const lo = min * graph.shortestHome, hi = max * graph.shortestHome;
  let best: { path: number[]; length: number } | null = null;
  for (let t = 0; t < tries; t++) {
    const used = new Set<number>();
    const seen = new Set<number>([graph.summit]);
    const path = [graph.summit];
    let at = graph.summit, length = 0, dead = false;
    while (at !== 0) {
      const options: Array<{ ei: number; to: number; len: number }> = [];
      for (let ei = 0; ei < graph.edges.length; ei++) {
        if (used.has(ei)) continue;
        const e = graph.edges[ei] as TrailEdge;
        const to = e.a === at ? e.b : e.b === at ? e.a : -1;
        if (to === -1 || seen.has(to)) continue;
        const trial = new Set(used);
        trial.add(ei);
        if (!reachesPad(graph, to, trial)) continue;
        const a = graph.nodes[e.a] as TrailNode, b = graph.nodes[e.b] as TrailNode;
        const dx = b.x - a.x, dz = b.z - a.z;
        options.push({ ei, to, len: Math.sqrt(dx * dx + dz * dz) });
      }
      if (options.length === 0) { dead = true; break; }
      const pick = options[Math.min(options.length - 1, Math.floor(rand() * options.length))] as { ei: number; to: number; len: number };
      used.add(pick.ei);
      seen.add(pick.to);
      length += pick.len;
      at = pick.to;
      path.push(at);
      if (length > hi) { dead = true; break; }
    }
    if (dead) continue;
    if (length >= lo && length <= hi) return { path: Object.freeze(path), length, inBand: true };
    if (best === null || length > best.length) best = { path, length };
  }
  if (best !== null) return { path: Object.freeze(best.path), length: best.length, inBand: false };
  const shortest = route(graph, graph.summit, 0);
  return { path: shortest, length: pathLength(graph, shortest), inBand: false };
}
