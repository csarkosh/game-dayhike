import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { bowlFor } from "../../src/sim/olympic.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT } from "../../src/sim/terrain.js";
import { nearestTrailNode, trailDistance, TRAIL_BED_HALF, type TrailGraph } from "../../src/sim/trail.js";
import { signPostSites, signPosts, SIGN_POST_HALF, SUMMIT_LABEL } from "../../src/sim/signs.js";
import { signSites } from "../../src/sim/placeNames.js";
import { hikerNames } from "../../src/sim/hikerNames.js";
import { createChunkGrid } from "../../src/sim/chunkGrid.js";
import { CHUNK_SIZE } from "../../src/sim/forestConstants.js";
import { PROBE_SEEDS } from "./trailGateSeeds.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

/**
 * The index, among the junction's edges in graph order, of the arm with the
 * shortest trail to `target` without crossing back through the junction:
 * the edge plus a plain Dijkstra from its neighbour, ties to the lower
 * neighbour id. Written apart from the sim's own walk, so it checks it.
 */
function nearestArm(graph: TrailGraph, junction: number, target: number): number {
  const gap = (a: number, b: number): number => {
    const p = graph.nodes[a]!, q = graph.nodes[b]!;
    return Math.sqrt((p.x - q.x) * (p.x - q.x) + (p.z - q.z) * (p.z - q.z));
  };
  const next = (n: number): number[] => graph.edges.flatMap((e) => (e.a === n ? [e.b] : e.b === n ? [e.a] : []));
  let best = -1, bestD = Infinity, bestN = Infinity;
  for (const [a, n] of next(junction).entries()) {
    const dist = new Map<number, number>([[n, 0]]);
    const done = new Set<number>([junction]);
    for (;;) {
      let u = -1, du = Infinity;
      for (const [k, d] of dist) if (!done.has(k) && d < du) { u = k; du = d; }
      if (u < 0 || u === target) break;
      done.add(u);
      for (const v of next(u)) if (!done.has(v) && du + gap(u, v) < (dist.get(v) ?? Infinity)) dist.set(v, du + gap(u, v));
    }
    const d = dist.get(target);
    if (d === undefined) continue;
    const total = gap(junction, n) + d;
    if (total < bestD || (total === bestD && n < bestN)) { best = a; bestD = total; bestN = n; }
  }
  return best;
}

describe("sign posts on real worlds", { timeout: 120_000 }, () => {
  it("tops every post with the Summit on its nearest arm, gives every arm a plank, repeats a name only for an arm with no other, keeps every post off the bed, and emits each post once as a prop", () => {
    for (const seed of PROBE_SEEDS) {
      const { graph } = bowlFor(seed);
      const crest = graph.nodes[graph.summit]!;
      // The sites the game names: the summit and every pond and meadow.
      const first = hikerNames(seed, 1)[0]!.split(" ")[0]!;
      const named = signSites(seed, graph.features, first, crest);
      const posts = signPosts(graph, named);
      const summitNode = nearestTrailNode(graph, named[0]!.x, named[0]!.z);
      const degree = new Map<number, number>();
      for (const e of graph.edges) { degree.set(e.a, (degree.get(e.a) ?? 0) + 1); degree.set(e.b, (degree.get(e.b) ?? 0) + 1); }
      const junctions = [...degree.values()].filter((d) => d >= 3).length;
      expect(posts, `seed ${seed}`).toHaveLength(junctions);
      const sites = signPostSites(graph);
      for (const [i, p] of posts.entries()) {
        const at = `seed ${seed} post ${i}`;
        // The Summit exactly once, on top, on the arm with the shortest trail to it.
        const all = p.arms.flatMap((a) => a.names);
        expect(all.filter((n) => n === SUMMIT_LABEL), at).toHaveLength(1);
        const arm = p.arms.findIndex((a) => a.names.includes(SUMMIT_LABEL));
        expect(p.arms[arm]!.ranks[p.arms[arm]!.names.indexOf(SUMMIT_LABEL)], at).toBe(0);
        expect(arm, at).toBe(nearestArm(graph, sites[i]!.node, summitNode));
        // Ranks run 0, 1, 2, ... down the post.
        expect(p.arms.flatMap((a) => a.ranks).sort((x, y) => x - y), at).toEqual(all.map((_, k) => k));
        for (const a of p.arms) expect(a.names.length, at).toBeGreaterThanOrEqual(1);
        // A name repeats only on arms that carry nothing else: of the arms
        // naming it, at most one has another plank.
        for (const name of new Set(all)) {
          const on = p.arms.filter((a) => a.names.includes(name));
          expect(on.filter((a) => a.names.length > 1).length, `${at} ${name}`).toBeLessThanOrEqual(1);
        }
      }
      const grid = createChunkGrid(seed);
      for (const p of posts) {
        expect(trailDistance(graph, p.x, p.z), `seed ${seed}`).toBeGreaterThanOrEqual(TRAIL_BED_HALF);
        const chunk = grid.chunkAt(Math.floor(p.x / CHUNK_SIZE), Math.floor(p.z / CHUNK_SIZE));
        const emitted = chunk.props.filter((b) => b.material === "signpost" && Math.abs(b.box.min.x + SIGN_POST_HALF.x - p.x) < 1e-6);
        expect(emitted, `seed ${seed} post at ${p.x},${p.z}`).toHaveLength(1);
      }
    }
  });
});
