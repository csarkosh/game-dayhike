import { describe, expect, it } from "vitest";
import "../../src/sim/passes/index.js";
import { bowlFor } from "../../src/sim/olympic.js";
import { setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT } from "../../src/sim/terrain.js";
import { nearestTrailNode, trailDistance, TRAIL_BED_HALF, type TrailGraph } from "../../src/sim/trail.js";
import { signPostSites, signPosts, SIGN_POST_HALF, SUMMIT_LABEL, TRAILHEAD_LABEL } from "../../src/sim/signs.js";
import { signSites } from "../../src/sim/placeNames.js";
import { hikerNames } from "../../src/sim/hikerNames.js";
import { createChunkGrid } from "../../src/sim/chunkGrid.js";
import { CHUNK_SIZE } from "../../src/sim/forestConstants.js";
import { PROBE_SEEDS } from "./trailGateSeeds.js";

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

/** Distances floated through two different walks agree to far better than this. */
const EPS = 1e-9;

/** One arm of a junction, measured apart from the sim's own walk so it checks it. */
type Arm = {
  /** The neighbour node. */
  n: number;
  /** Trail distance from the junction to every node down this arm, never back through the junction. */
  down: Map<number, number>;
  /** Trail distance from the junction to every node by this arm, back through the junction allowed. */
  round: Map<number, number>;
};

/** A plain Dijkstra from `start`, never entering `avoid`, every distance plus `lead`. */
function walk(adj: readonly (readonly number[])[], gap: (a: number, b: number) => number, start: number, avoid: number, lead: number): Map<number, number> {
  const dist = new Map<number, number>([[start, 0]]);
  const done = new Set<number>([avoid]);
  const out = new Map<number, number>();
  for (;;) {
    let u = -1, du = Infinity;
    for (const [k, d] of dist) if (!done.has(k) && d < du) { u = k; du = d; }
    if (u < 0) break;
    done.add(u);
    out.set(u, lead + du);
    for (const v of adj[u]!) if (!done.has(v) && du + gap(u, v) < (dist.get(v) ?? Infinity)) dist.set(v, du + gap(u, v));
  }
  return out;
}

/** The junction's arms in graph edge order, each with its distances. */
function armsOf(graph: TrailGraph, adj: readonly (readonly number[])[], junction: number): Arm[] {
  const gap = (a: number, b: number): number => {
    const p = graph.nodes[a]!, q = graph.nodes[b]!;
    return Math.sqrt((p.x - q.x) * (p.x - q.x) + (p.z - q.z) * (p.z - q.z));
  };
  return adj[junction]!.map((n) => ({
    n,
    down: walk(adj, gap, n, junction, gap(junction, n)),
    round: walk(adj, gap, n, -1, gap(junction, n)),
  }));
}

/** The index of the arm with the shortest way down it to `node`, ties to the lower neighbour id; -1 if none. */
function nearestArm(arms: readonly Arm[], node: number): number {
  let best = -1;
  for (const [a, arm] of arms.entries()) {
    const d = arm.down.get(node);
    if (d === undefined) continue;
    const held = best < 0 ? undefined : arms[best]!.down.get(node)!;
    if (held === undefined || d < held || (d === held && arm.n < arms[best]!.n)) best = a;
  }
  return best;
}

describe("sign posts on real worlds", { timeout: 120_000 }, () => {
  it("follows the plank rules on every post, keeps every post off the bed, and emits each post once as a prop", () => {
    let most = 0, total = 0, fillers = 0;
    for (const seed of PROBE_SEEDS) {
      const { graph } = bowlFor(seed);
      const crest = graph.nodes[graph.summit]!;
      // The sites the game names: the summit and every pond and meadow.
      const first = hikerNames(seed, 1)[0]!.split(" ")[0]!;
      const named = signSites(seed, graph.features, first, crest);
      const posts = signPosts(graph, named);
      const nodeOf = new Map<string, number>([[TRAILHEAD_LABEL, 0]]);
      for (const s of named) nodeOf.set(s.name, nearestTrailNode(graph, s.x, s.z));
      const adj: number[][] = graph.nodes.map(() => []);
      for (const e of graph.edges) { adj[e.a]!.push(e.b); adj[e.b]!.push(e.a); }
      const junctions = adj.filter((l) => l.length >= 3).length;
      expect(posts, `seed ${seed}`).toHaveLength(junctions);
      const sites = signPostSites(graph);
      for (const [i, p] of posts.entries()) {
        const at = `seed ${seed} post ${i}`;
        const j = sites[i]!.node;
        const arms = armsOf(graph, adj, j);
        const places = [...nodeOf].filter(([, node]) => node !== j);
        const all = p.arms.flatMap((a) => a.names);
        most = Math.max(most, all.length);
        total += all.length;
        // Rule 3: the Summit exactly once, on top, on its nearest arm.
        expect(all.filter((n) => n === SUMMIT_LABEL), at).toHaveLength(1);
        // Rule 1: every arm has a plank, and the ranks run 0, 1, 2, ... down the post.
        for (const a of p.arms) expect(a.names.length, at).toBeGreaterThanOrEqual(1);
        expect(p.arms.flatMap((a) => a.ranks).sort((x, y) => x - y), at).toEqual(all.map((_, k) => k));
        const byRank: { name: string; dist: number }[] = [];
        for (const [a, arm] of p.arms.entries()) {
          for (const [k, name] of arm.names.entries()) {
            const node = nodeOf.get(name)!;
            const home = nearestArm(arms, node);
            if (home === a) {
              // Rule 2: a place on the arm with the shortest way to it.
              byRank[arm.ranks[k]!] = { name, dist: arms[a]!.down.get(node)! };
              continue;
            }
            // Rule 4: otherwise a filler, alone on an arm that wins nothing,
            // naming the nearest place other than the Summit down that arm,
            // or by way of the junction when there is none.
            fillers++;
            expect(name, `${at} ${name}`).not.toBe(SUMMIT_LABEL);
            expect(arm.names, `${at} ${name}`).toHaveLength(1);
            for (const [other] of places) expect(nearestArm(arms, nodeOf.get(other)!), `${at} ${other}`).not.toBe(a);
            const others = places.filter(([n]) => n !== SUMMIT_LABEL);
            const downs = others.flatMap(([, n]) => arms[a]!.down.has(n) ? [arms[a]!.down.get(n)!] : []);
            const way = downs.length > 0 ? arms[a]!.down : arms[a]!.round;
            const dist = way.get(node)!;
            const nearest = Math.min(...others.flatMap(([, n]) => way.has(n) ? [way.get(n)!] : []));
            expect(Math.abs(dist - nearest), `${at} ${name}`).toBeLessThan(EPS);
            byRank[arm.ranks[k]!] = { name, dist };
          }
        }
        // Rule 5: the Summit on top, the rest nearest first.
        expect(byRank[0]!.name, at).toBe(SUMMIT_LABEL);
        expect(nearestArm(arms, nodeOf.get(SUMMIT_LABEL)!), at).toBe(p.arms.findIndex((a) => a.names.includes(SUMMIT_LABEL)));
        for (let r = 2; r < byRank.length; r++) expect(byRank[r]!.dist, `${at} rank ${r}`).toBeGreaterThanOrEqual(byRank[r - 1]!.dist - EPS);
      }
      const grid = createChunkGrid(seed);
      for (const p of posts) {
        expect(trailDistance(graph, p.x, p.z), `seed ${seed}`).toBeGreaterThanOrEqual(TRAIL_BED_HALF);
        const chunk = grid.chunkAt(Math.floor(p.x / CHUNK_SIZE), Math.floor(p.z / CHUNK_SIZE));
        const emitted = chunk.props.filter((b) => b.material === "signpost" && Math.abs(b.box.min.x + SIGN_POST_HALF.x - p.x) < 1e-6);
        expect(emitted, `seed ${seed} post at ${p.x},${p.z}`).toHaveLength(1);
      }
    }
    // The most planks on one post, every plank on the five seeds, and how many are fillers.
    expect({ most, total, fillers }).toEqual({ most: 5, total: 163, fillers: 17 });
  });
});
