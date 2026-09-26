/**
 * Wooden sign posts at every junction of the trail graph, one arm per branch,
 * each arm naming the two nearest places that branch leads to (B §2.5). Pure
 * geometry over the graph: the pass emits the post's collision box,
 * `game/signMeshes.ts` paints the arms.
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
  /** At most ARM_NAMES of them, nearest by trail distance first. */
  names: string[];
};
export type SignPost = { x: number; z: number; arms: SignArm[] };

export const TRAILHEAD_LABEL = "Trailhead";
export const SUMMIT_LABEL = "Summit";
/** How many places one arm names: two fit an arm's face legibly. */
export const ARM_NAMES = 2;
/** Metres from the junction node to the post: off the bed, on the shoulder. */
export const SIGN_POST_OFFSET = TRAIL_BED_HALF + 1;
export const SIGN_POST_HALF: Vec3 = { x: 0.1, y: 1.1, z: 0.1 };

const R2 = Math.SQRT1_2;
const COMPASS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [R2, R2], [0, 1], [-R2, R2], [-1, 0], [-R2, -R2], [0, -1], [R2, -R2],
];

type NamedSite = { name: string; x: number; z: number };
type Link = { to: number; len: number };

function nodeGap(a: TrailNode, b: TrailNode): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Visits the nodes reachable from `start` without passing through `avoid`,
 * in order of trail distance from `start` (Dijkstra over straight
 * node-to-node lengths, since edges carry none; ties to the lower node id).
 * A binary heap keeps it cheap on the braid's many nodes, and `visit`
 * returning true ends the walk once the caller has what it needs.
 */
function nearestFirst(
  links: readonly (readonly Link[])[], start: number, avoid: number,
  visit: (node: number) => boolean,
): void {
  const dist = new Map<number, number>([[start, 0]]);
  const done = new Set<number>([avoid]);
  // Heap entries are [distance, node]; the order is distance, then node id.
  const heap: Array<[number, number]> = [[0, start]];
  const less = (a: [number, number], b: [number, number]): boolean => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (e: [number, number]): void => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (!less(heap[i] as [number, number], heap[up] as [number, number])) break;
      [heap[i], heap[up]] = [heap[up] as [number, number], heap[i] as [number, number]];
      i = up;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0] as [number, number];
    const last = heap.pop() as [number, number];
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l] as [number, number], heap[m] as [number, number])) m = l;
        if (r < heap.length && less(heap[r] as [number, number], heap[m] as [number, number])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m] as [number, number], heap[i] as [number, number]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length > 0) {
    const [d, node] = pop();
    if (done.has(node)) continue;
    done.add(node);
    if (visit(node)) return;
    for (const { to, len } of links[node] ?? []) {
      if (done.has(to)) continue;
      const nd = d + len;
      const known = dist.get(to);
      if (known !== undefined && known <= nd) continue;
      dist.set(to, nd);
      push([nd, to]);
    }
  }
}

/** Where a post stands: its junction node, and the post's own position. */
export type SignPostSite = { node: number; x: number; z: number };

/**
 * Where the posts stand, without their names: one per junction (a node with
 * three or more edges), SIGN_POST_OFFSET from the node in whichever of eight
 * compass directions is farthest from every edge — never on the bed,
 * whatever angles the branches leave at. The chunk pass needs only this, so
 * it never pays for the walks that name the arms.
 */
export function signPostSites(graph: TrailGraph): SignPostSite[] {
  const degree = new Array<number>(graph.nodes.length).fill(0);
  for (const e of graph.edges) {
    degree[e.a] = (degree[e.a] as number) + 1;
    degree[e.b] = (degree[e.b] as number) + 1;
  }
  const out: SignPostSite[] = [];
  for (let j = 0; j < graph.nodes.length; j++) {
    if ((degree[j] as number) < 3) continue;
    const here = graph.nodes[j] as TrailNode;
    let best = COMPASS[0] as readonly [number, number];
    let bestD = -1;
    for (const dir of COMPASS) {
      const d = trailDistance(graph, here.x + dir[0] * SIGN_POST_OFFSET, here.z + dir[1] * SIGN_POST_OFFSET);
      if (d > bestD) {
        bestD = d;
        best = dir;
      }
    }
    out.push({ node: j, x: here.x + best[0] * SIGN_POST_OFFSET, z: here.z + best[1] * SIGN_POST_OFFSET });
  }
  return out;
}

/**
 * One post per junction (`signPostSites`). Each arm names the ARM_NAMES places
 * nearest by trail distance beyond it: the walk starts at the arm's neighbour
 * and never crosses back through the junction, and "Trailhead" (node 0) is a
 * place like any other, so on a loop both arms of the fork name the loop's
 * place. A site is read at its nearest node; two sites at one node keep their
 * order in `sites`.
 */
export function signPosts(graph: TrailGraph, sites: readonly NamedSite[]): SignPost[] {
  const links: Link[][] = graph.nodes.map(() => []);
  for (const e of graph.edges) {
    const len = nodeGap(graph.nodes[e.a] as TrailNode, graph.nodes[e.b] as TrailNode);
    (links[e.a] as Link[]).push({ to: e.b, len });
    (links[e.b] as Link[]).push({ to: e.a, len });
  }
  const namesAt = new Map<number, string[]>();
  const nameAt = (node: number, name: string): void => {
    const list = namesAt.get(node);
    if (list === undefined) namesAt.set(node, [name]);
    else list.push(name);
  };
  nameAt(0, TRAILHEAD_LABEL);
  for (const s of sites) nameAt(nearestTrailNode(graph, s.x, s.z), s.name);

  return signPostSites(graph).map(({ node: j, x, z }) => {
    const here = graph.nodes[j] as TrailNode;
    const arms: SignArm[] = [];
    for (const { to: n } of links[j] as Link[]) {
      const there = graph.nodes[n] as TrailNode;
      const ex = there.x - here.x, ez = there.z - here.z;
      const len = Math.sqrt(ex * ex + ez * ez);
      const names: string[] = [];
      nearestFirst(links, n, j, (node) => {
        for (const name of namesAt.get(node) ?? []) {
          if (names.length < ARM_NAMES && !names.includes(name)) names.push(name);
        }
        return names.length >= ARM_NAMES;
      });
      arms.push({ dx: len > 0 ? ex / len : 1, dz: len > 0 ? ez / len : 0, names });
    }
    return { x, z, arms };
  });
}
