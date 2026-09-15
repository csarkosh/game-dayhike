/**
 * Wooden sign posts at every junction of the trail graph, one arm per branch,
 * each arm naming the sites that branch leads to (B §2.5). Pure geometry over
 * the graph: the pass emits the post's collision box, `game/signMeshes.ts`
 * paints the arms.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot. Arms carry
 * unit directions, never angles.
 */
import type { TrailGraph, TrailNode } from "./trail.js";
import { TRAIL_BED_HALF, nearestTrailNode, trailDistance } from "./trail.js";
import type { Vec3 } from "./types.js";

export type SignArm = {
  /** Unit direction the arm points, from the post. */
  dx: number;
  dz: number;
  /** Nearest first. */
  names: string[];
};
export type SignPost = { x: number; z: number; arms: SignArm[] };

export const TRAILHEAD_LABEL = "Trailhead";
/** Metres from the junction node to the post: off the bed, on the shoulder. */
export const SIGN_POST_OFFSET = TRAIL_BED_HALF + 1;
export const SIGN_POST_HALF: Vec3 = { x: 0.1, y: 1.1, z: 0.1 };

const R2 = Math.SQRT1_2;
const COMPASS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [R2, R2], [0, 1], [-R2, R2], [-1, 0], [-R2, -R2], [0, -1], [R2, -R2],
];

type NamedSite = { name: string; x: number; z: number };

/** Nodes reachable from `start` without passing through `avoid`, in graph-distance order. */
function reachable(adjacency: readonly (readonly number[])[], start: number, avoid: number): number[] {
  const seen = new Set<number>([avoid, start]);
  const order = [start];
  for (let i = 0; i < order.length; i++) {
    for (const n of adjacency[order[i] as number] ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      order.push(n);
    }
  }
  return order;
}

export function signPosts(graph: TrailGraph, sites: readonly NamedSite[]): SignPost[] {
  const adjacency: number[][] = graph.nodes.map(() => []);
  for (const e of graph.edges) {
    (adjacency[e.a] as number[]).push(e.b);
    (adjacency[e.b] as number[]).push(e.a);
  }
  // Each site is read at its nearest node; a branch names the sites whose
  // node it reaches. Nearest first along the branch is the search order.
  const siteNode = sites.map((s) => nearestTrailNode(graph, s.x, s.z));

  const posts: SignPost[] = [];
  for (let j = 0; j < graph.nodes.length; j++) {
    const neighbours = adjacency[j] as number[];
    if (neighbours.length < 3) continue;
    const here = graph.nodes[j] as TrailNode;
    const arms: SignArm[] = [];
    for (const n of neighbours) {
      const there = graph.nodes[n] as TrailNode;
      const ex = there.x - here.x, ez = there.z - here.z;
      const len = Math.sqrt(ex * ex + ez * ez);
      const names: string[] = [];
      for (const node of reachable(adjacency, n, j)) {
        if (node === 0) names.push(TRAILHEAD_LABEL);
        for (const [i, s] of sites.entries()) {
          if (siteNode[i] === node && !names.includes(s.name)) names.push(s.name);
        }
      }
      arms.push({ dx: len > 0 ? ex / len : 1, dz: len > 0 ? ez / len : 0, names });
    }
    // The post stands SIGN_POST_OFFSET from the node in whichever of eight
    // compass directions is farthest from every edge — never on the bed,
    // whatever angles the branches leave at.
    let best = COMPASS[0] as readonly [number, number];
    let bestD = -1;
    for (const dir of COMPASS) {
      const d = trailDistance(graph, here.x + dir[0] * SIGN_POST_OFFSET, here.z + dir[1] * SIGN_POST_OFFSET);
      if (d > bestD) {
        bestD = d;
        best = dir;
      }
    }
    posts.push({ x: here.x + best[0] * SIGN_POST_OFFSET, z: here.z + best[1] * SIGN_POST_OFFSET, arms });
  }
  return posts;
}
