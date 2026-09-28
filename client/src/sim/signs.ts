/**
 * Wooden sign posts at every junction of the trail graph, one arm per branch
 * and one plank per place: each place named once on a post, on the
 * arm with the shortest trail to it, the Summit on top. Pure geometry over the
 * graph: the pass emits the post's collision box, `game/signMeshes.ts` paints
 * the planks.
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
  /** One place per plank, in the post's order (`ranks`), top plank first. */
  names: string[];
  /**
   * Each plank's place on its post, counted from the top across every arm:
   * 0 is the post's top plank. Parallel to `names`; a post's ranks run 0, 1,
   * 2, ... with no gaps.
   */
  ranks: number[];
};
export type SignPost = { x: number; z: number; arms: SignArm[] };

export const TRAILHEAD_LABEL = "Trailhead";
export const SUMMIT_LABEL = "Summit";
/** The trail's name, as the board at its entrance and the poster give it. */
export const TRAIL_NAME = "Trail 14";
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
  visit: (node: number, dist: number) => boolean,
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
    if (visit(node, d)) return;
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

/** One plank: a place, the arm it hangs on, and the trail distance to it that way. */
type Plank = { arm: number; name: string; dist: number };

/**
 * One post per junction (`signPostSites`), one arm per branch, one plank per
 * place. The trail distance to a place by an arm is the arm's edge plus the
 * shortest walk from its neighbour that never crosses back through the
 * junction; "Trailhead" (node 0) is a place like any other, and a site is read
 * at its nearest node. Every place reachable that way goes on the post once,
 * on the arm with the shortest distance to it (ties to the arm whose
 * neighbour has the lower node id). An arm that wins nothing still gets one
 * plank, naming the nearest place down it other than the Summit — the one way
 * a name repeats on a post — and an arm with no such place beyond it names the
 * nearest one found by a walk from its neighbour that may cross back through
 * the junction; only where no other place can be reached at all does it name
 * the Summit a second time. A place at the junction's own node is never named on its post.
 * The Summit's plank is the post's top one; the rest follow nearest first.
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

  /**
   * The places a walk from `start` finds, nearest first, each at its first
   * (shortest) distance plus `lead`, never one standing at `junction`; `stop`
   * of them at most.
   */
  const reach = (start: number, avoid: number, junction: number, lead: number, stop: number): { name: string; dist: number }[] => {
    const found: { name: string; dist: number }[] = [];
    const seen = new Set<string>(namesAt.get(junction) ?? []);
    nearestFirst(links, start, avoid, (node, d) => {
      if (node !== junction) {
        for (const name of namesAt.get(node) ?? []) {
          if (seen.has(name)) continue;
          seen.add(name);
          found.push({ name, dist: lead + d });
        }
      }
      return found.length >= stop;
    });
    return found;
  };

  return signPostSites(graph).map(({ node: j, x, z }) => {
    const here = graph.nodes[j] as TrailNode;
    const out = links[j] as Link[];
    const elsewhere = new Set<string>();
    for (const [node, names] of namesAt) if (node !== j) for (const name of names) elsewhere.add(name);
    for (const name of namesAt.get(j) ?? []) elsewhere.delete(name);
    // Every place each arm reaches, nearest first.
    const byArm = out.map(({ to, len }) => reach(to, j, j, len, elsewhere.size));
    // Each place to the arm with the shortest way there.
    const best = new Map<string, Plank>();
    for (const [a, found] of byArm.entries()) {
      for (const { name, dist } of found) {
        const held = best.get(name);
        if (
          held === undefined || dist < held.dist ||
          (dist === held.dist && (out[a] as Link).to < (out[held.arm] as Link).to)
        ) best.set(name, { arm: a, name, dist });
      }
    }
    const planks: Plank[] = [...best.values()];
    const summit = best.get(SUMMIT_LABEL);
    // An arm that wins nothing names its nearest place anyway, however far
    // round, so no board points down a branch in silence — but never the
    // Summit, which points only down its shortest way while any other place
    // can stand in for it.
    const notSummit = (found: readonly { name: string; dist: number }[]) => found.find((f) => f.name !== SUMMIT_LABEL);
    for (const [a, { to, len }] of out.entries()) {
      if (planks.some((p) => p.arm === a)) continue;
      const down = byArm[a] as { name: string; dist: number }[];
      let nearest = notSummit(down);
      if (nearest === undefined) {
        const round = reach(to, -1, j, len, elsewhere.size);
        nearest = notSummit(round) ?? down[0] ?? round[0];
      }
      if (nearest !== undefined) planks.push({ arm: a, name: nearest.name, dist: nearest.dist });
    }
    planks.sort((p, q) => {
      if (p === q) return 0;
      if (p === summit || q === summit) return p === summit ? -1 : 1;
      if (p.dist !== q.dist) return p.dist - q.dist;
      return (out[p.arm] as Link).to - (out[q.arm] as Link).to;
    });
    const arms: SignArm[] = out.map(({ to: n }) => {
      const there = graph.nodes[n] as TrailNode;
      const ex = there.x - here.x, ez = there.z - here.z;
      const len = Math.sqrt(ex * ex + ez * ez);
      return { dx: len > 0 ? ex / len : 1, dz: len > 0 ? ez / len : 0, names: [], ranks: [] };
    });
    for (const [rank, { arm, name }] of planks.entries()) {
      const onArm = arms[arm] as SignArm;
      onArm.names.push(name);
      onArm.ranks.push(rank);
    }
    return { x, z, arms };
  });
}
