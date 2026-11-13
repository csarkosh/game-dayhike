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
 * The point `progress` of the way up the stem (0 the pad's end, 1 the crest),
 * by arc length, with the stem's unit direction there (up the stem) for a
 * side to stand off it; null when the stem has no length. The dropped cap
 * lies beside it (game/droppedItem.ts).
 */
export function stemPointAt(graph: TrailGraph, progress: number): { x: number; z: number; dx: number; dz: number } | null {
  const chain = stemNodes(graph);
  let total = 0;
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = graph.nodes[chain[i] as number] as TrailNode;
    const b = graph.nodes[chain[i + 1] as number] as TrailNode;
    total += Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
  }
  if (total <= 0) return null;
  // The chain runs pad first, so the arc from its start is the way up.
  let want = Math.max(0, Math.min(1, progress)) * total;
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = graph.nodes[chain[i] as number] as TrailNode;
    const b = graph.nodes[chain[i + 1] as number] as TrailNode;
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (want <= len || i + 2 === chain.length) {
      const t = len > 0 ? Math.max(0, Math.min(1, want / len)) : 0;
      return { x: a.x + dx * t, z: a.z + dz * t, dx: len > 0 ? dx / len : 0, dz: len > 0 ? dz / len : 0 };
    }
    want -= len;
  }
  return null;
}

/**
 * The point `metres` further up the stem than (x, z)'s nearest point on it,
 * by arc length; null when that is past the crest, or the stem has no
 * length. The watcher's first showings stand there (watcher.ts).
 */
export function stemAhead(graph: TrailGraph, x: number, z: number, metres: number): { x: number; z: number } | null {
  const chain = stemNodes(graph);
  let total = 0;
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = graph.nodes[chain[i] as number] as TrailNode;
    const b = graph.nodes[chain[i + 1] as number] as TrailNode;
    total += Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
  }
  if (!(total > 0)) return null;
  const want = (1 - stemProgress(graph, x, z)) * total + metres;
  if (want > total) return null;
  let arc = 0;
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = graph.nodes[chain[i] as number] as TrailNode;
    const b = graph.nodes[chain[i + 1] as number] as TrailNode;
    const len = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
    if (len > 0 && want <= arc + len) {
      const t = (want - arc) / len;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    arc += len;
  }
  const crest = graph.nodes[chain[chain.length - 1] as number] as TrailNode;
  return { x: crest.x, z: crest.z };
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

/** Every node of degree ≥ 3, ascending: the trail's forks. */
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
