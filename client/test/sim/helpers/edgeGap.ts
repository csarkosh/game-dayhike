import type { TrailGraph } from "../../../src/sim/trail.js";
import { segmentSegmentDistanceSq } from "../../../src/sim/trail.js";

/**
 * Walking distance from `from` to every node reachable within `gap`, via a
 * relaxation over edges (all edge lengths are positive, so this is
 * Dijkstra-by-repeated-relaxation rather than a priority queue). Mirrors
 * `trailBuild.test.ts`'s "near" helper in its "holds every edge's profile
 * under the hard cap and every non-adjacent pair TRAIL_EDGE_MIN_GAP apart"
 * test.
 */
function near(graph: TrailGraph, from: number, gap: number): Map<number, number> {
  const d = new Map<number, number>([[from, 0]]);
  for (;;) {
    let moved = false;
    for (const e of graph.edges) {
      const L = Math.hypot(graph.nodes[e.b]!.x - graph.nodes[e.a]!.x, graph.nodes[e.b]!.z - graph.nodes[e.a]!.z);
      for (const [p, q] of [[e.a, e.b], [e.b, e.a]] as const) {
        const dp = d.get(p);
        if (dp === undefined || dp + L >= gap) continue;
        if ((d.get(q) ?? Infinity) > dp + L) {
          d.set(q, dp + L);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return d;
}

/**
 * Every non-adjacent-by-walking edge pair of `graph` whose segments come
 * closer than `gap`. Two edges are exempt when their nearest endpoints are
 * less than `gap` of walking distance apart — the trail's own measure of
 * "the same junction", not node identity (two edges of one junction can sit
 * on nodes that never coincide, yet legitimately run closer than `gap`).
 * Copied from `trailBuild.test.ts`'s "holds every edge's profile under the
 * hard cap and every non-adjacent pair TRAIL_EDGE_MIN_GAP apart" test so the
 * exemption rule stays identical on the synthetic frames and the 227-seed
 * sweep.
 */
export function closeNonAdjacentEdgePairs(graph: TrailGraph, gap: number): Array<[number, number]> {
  const within = new Map<number, Map<number, number>>();
  for (let n = 0; n < graph.nodes.length; n++) within.set(n, near(graph, n, gap));
  const close: Array<[number, number]> = [];
  for (let i = 0; i < graph.edges.length; i++) {
    for (let j = i + 1; j < graph.edges.length; j++) {
      const e = graph.edges[i]!, f = graph.edges[j]!;
      const linked = [e.a, e.b].some((p) => [f.a, f.b].some((q) => within.get(p)!.has(q)));
      if (linked) continue;
      const a = graph.nodes[e.a]!, b = graph.nodes[e.b]!, c = graph.nodes[f.a]!, d = graph.nodes[f.b]!;
      if (segmentSegmentDistanceSq(a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z) < gap * gap - 1e-6) close.push([i, j]);
    }
  }
  return close;
}
