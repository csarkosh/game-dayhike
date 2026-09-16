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

function edgeLength(graph: TrailGraph, e: TrailEdge): number {
  const a = graph.nodes[e.a] as TrailNode;
  const b = graph.nodes[e.b] as TrailNode;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dz * dz);
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

  const n = graph.nodes.length;
  const dist: number[] = new Array<number>(n).fill(Infinity);
  const prev: number[] = new Array<number>(n).fill(-1);
  const done: boolean[] = new Array<boolean>(n).fill(false);
  dist[from] = 0;
  for (let round = 0; round < n; round++) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (done[i] || (dist[i] as number) === Infinity) continue;
      if (u === -1 || (dist[i] as number) < (dist[u] as number)) u = i;
    }
    if (u === -1 || u === to) break;
    done[u] = true;
    for (const e of graph.edges) {
      const v = e.a === u ? e.b : e.b === u ? e.a : -1;
      if (v === -1 || done[v]) continue;
      const d = (dist[u] as number) + edgeLength(graph, e);
      if (d < (dist[v] as number)) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }

  const path: number[] = [];
  if ((dist[to] as number) < Infinity) {
    for (let at = to; at !== -1; at = prev[at] as number) path.push(at);
    path.reverse();
  }
  const out: readonly number[] = Object.freeze(path);
  table.set(key, out);
  return out;
}
