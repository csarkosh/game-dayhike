import { describe, expect, it } from "vitest";
import {
  SIGN_POST_OFFSET, SUMMIT_LABEL, TRAILHEAD_LABEL, TRAIL_NAME, allSignPosts, signPostSites, signPosts, trailSign, trailSignSite,
} from "../../src/sim/signs.js";
import { trailDistance, TRAIL_BED_HALF, type TrailEdge, type TrailGraph } from "../../src/sim/trail.js";
import { graph } from "./helpers/stemGraph.js";

const sites = (g: ReturnType<typeof graph>) => [
  { name: SUMMIT_LABEL, x: 200, z: 0 },
  ...(g.loops.length >= 1 ? [{ name: "the meadow", x: 150, z: 50 }] : []),
];

describe("signPosts", () => {
  it("labels the ends of the trail Trailhead and Summit", () => {
    expect(TRAILHEAD_LABEL).toBe("Trailhead");
    expect(SUMMIT_LABEL).toBe("Summit");
  });

  it("stands one post at every junction, a plank per place on the arm nearest it, the Summit on top", () => {
    const g = graph(1);
    const posts = signPosts(g, sites(g));
    // Only node 1 has three branches: the loop rejoins at the summit node,
    // whose degree is two.
    expect(posts).toHaveLength(1);
    const atJunction = posts.find((p) => Math.abs(p.x - 100) < SIGN_POST_OFFSET + 0.01 && Math.abs(p.z) < SIGN_POST_OFFSET + 0.01)!;
    // The loop reaches the Summit too, and the stem the meadow, but each
    // place goes only on the arm with the shorter way there: the Summit 100
    // m up the stem, the meadow 54 m round the loop, the trailhead 100 m back.
    expect(atJunction.arms.map((a) => ({ names: a.names, ranks: a.ranks }))).toEqual([
      { names: ["Trailhead"], ranks: [2] },
      { names: ["Summit"], ranks: [0] },
      { names: ["the meadow"], ranks: [1] },
    ]);
    expect(atJunction.arms[2]!.dz).toBeGreaterThan(0.7); // the loop leaves toward +z
    expect(atJunction.arms[0]!.dx).toBeCloseTo(-1, 6);
  });

  it("names a place once, on the nearer arm; tops the post with the Summit; repeats a place only on an arm that wins none, and names one down a dead end", () => {
    // A junction at node 1 with five branches: back to the trailhead (0);
    // east over the bridge (2) to the Summit (3); north (4) to North Lake
    // (5), with a long way round from 4 to the Summit; south (6), which only
    // loops back to the trailhead; and a spur (7) that goes nowhere.
    const node = (x: number, z: number) => ({ x, z, h: 0, u: 0 });
    const edge = (a: number, b: number): TrailEdge => ({ a, b, kind: "stem", profile: new Float64Array([0, 0]), progress0: 0, progress1: 0 });
    const g = {
      nodes: [node(0, 0), node(100, 0), node(180, 0), node(300, 0), node(100, 100), node(100, 150), node(100, -60), node(130, -40)],
      edges: [edge(0, 1), edge(1, 2), edge(2, 3), edge(1, 4), edge(4, 3), edge(4, 5), edge(1, 6), edge(6, 0), edge(1, 7)],
    } as unknown as TrailGraph;
    const posts = signPosts(g, [
      { name: SUMMIT_LABEL, x: 300, z: 0 },
      { name: "the bridge", x: 180, z: 0 },
      { name: "North Lake", x: 100, z: 150 },
    ]);
    // Node 4 is a junction too; the post read is node 1's.
    expect(posts).toHaveLength(2);
    const post = posts.find((p) => Math.abs(p.x - 100) < 3 && Math.abs(p.z) < 3)!;
    expect(post.arms.map((a) => ({ names: a.names, ranks: a.ranks }))).toEqual([
      // Back to the trailhead: 100 m.
      { names: ["Trailhead"], ranks: [2] },
      // The Summit is 200 m this way and 323.6 m by the north arm, so it is
      // here and on top; the bridge (80 m) is the post's nearest place.
      { names: ["Summit", "the bridge"], ranks: [0, 1] },
      // North Lake: 150 m this way, 473.6 m by the bridge.
      { names: ["North Lake"], ranks: [3] },
      // South reaches only the trailhead, 176.6 m round, and wins nothing:
      // it names the trailhead anyway.
      { names: ["Trailhead"], ranks: [4] },
      // The spur reaches nothing without coming back: its nearest place by
      // way of the junction is the bridge, 50 + 50 + 80 m.
      { names: ["the bridge"], ranks: [5] },
    ]);
  });

  it("breaks a tie in trail distance toward the arm with the lower neighbour, and fills the losing arm with a place other than the Summit", () => {
    // From the junction at node 1, two equal branches (via 3 and via 2, the
    // edge to 3 listed first) meet again at the Summit, 161.8 m either way.
    const node = (x: number, z: number) => ({ x, z, h: 0, u: 0 });
    const edge = (a: number, b: number): TrailEdge => ({ a, b, kind: "stem", profile: new Float64Array([0, 0]), progress0: 0, progress1: 0 });
    const g = {
      nodes: [node(-100, 0), node(0, 0), node(0, 50), node(0, -50), node(100, 0)],
      edges: [edge(0, 1), edge(1, 3), edge(1, 2), edge(3, 4), edge(2, 4)],
    } as unknown as TrailGraph;
    const posts = signPosts(g, [{ name: SUMMIT_LABEL, x: 100, z: 0 }]);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.arms.map((a) => ({ dz: a.dz, names: a.names, ranks: a.ranks }))).toEqual([
      { dz: 0, names: ["Trailhead"], ranks: [1] },
      // The arm by node 3 loses the tie and wins nothing. The Summit is the
      // only place down it, so it names the nearest other place by way of
      // the junction: the trailhead, 50 + 50 + 100 m.
      { dz: -1, names: ["Trailhead"], ranks: [2] },
      { dz: 1, names: ["Summit"], ranks: [0] },
    ]);

    // With a lake past the Summit, the losing arm names the lake down its own
    // branch (161.8 + 100 m), not the nearer Summit; the lake itself goes to
    // the winning arm, tied at the same distance.
    g.nodes.push(node(200, 0));
    g.edges.push(edge(4, 5));
    const withLake = signPosts(g, [{ name: SUMMIT_LABEL, x: 100, z: 0 }, { name: "Far Lake", x: 200, z: 0 }]);
    expect(withLake[0]!.arms.map((a) => ({ names: a.names, ranks: a.ranks }))).toEqual([
      { names: ["Trailhead"], ranks: [1] },
      { names: ["Far Lake"], ranks: [3] },
      { names: ["Summit", "Far Lake"], ranks: [0, 2] },
    ]);
  });

  it("stands the posts where signPostSites says, names or no names", () => {
    const g = graph(2);
    const sites = signPostSites(g);
    expect(sites.map((s) => s.node)).toEqual([1, 2]);
    const posts = signPosts(g, [{ name: "Summit", x: 200, z: 0 }]);
    expect(posts.map((p) => ({ x: p.x, z: p.z }))).toEqual(sites.map((s) => ({ x: s.x, z: s.z })));
  });

  it("counts the trailhead as a place like any other, orders a post nearest first below the Summit, and never names a post's own node", () => {
    const g = graph(2);
    const posts = signPosts(g, [
      { name: "Summit", x: 200, z: 0 },
      { name: "the lower meadow", x: 150, z: 50 },
      { name: "the upper meadow", x: 150, z: -50 },
    ]);
    // At the fork: the Summit up the stem on top, then the two meadows 53.9
    // m round their loops (the lower meadow's arm has the lower neighbour),
    // then the trailhead 100 m back.
    const atFork = posts.find((p) => Math.abs(p.x - 100) < 3)!;
    expect(atFork.arms.map((a) => ({ names: a.names, ranks: a.ranks }))).toEqual([
      { names: ["Trailhead"], ranks: [3] },
      { names: ["Summit"], ranks: [0] },
      { names: ["the lower meadow"], ranks: [1] },
      { names: ["the upper meadow"], ranks: [2] },
    ]);
    // Both loops rejoin at the crest, so it is a junction too, and it stands
    // on the Summit's own node: its post names only the places away from it.
    const atCrest = posts.find((p) => Math.abs(p.x - 200) < 3)!;
    expect(atCrest.arms.map((a) => ({ names: a.names, ranks: a.ranks }))).toEqual([
      { names: ["Trailhead"], ranks: [2] },
      { names: ["the lower meadow"], ranks: [0] },
      { names: ["the upper meadow"], ranks: [1] },
    ]);
  });

  it("stands the post off the bed", () => {
    const g = graph(1);
    for (const p of signPosts(g, sites(g))) {
      expect(trailDistance(g, p.x, p.z)).toBeGreaterThanOrEqual(TRAIL_BED_HALF);
    }
  });

  it("stands no post on a world with no junction", () => {
    const g = graph(0);
    expect(signPosts(g, sites(g))).toEqual([]);
  });
});

describe("the trail's sign", () => {
  // The stem leaves along +x from the pad at the origin: the entrance is
  // (8, 0). The board stands at (2, 7); a player spawns at (1.3, 0).
  const board = { x: 2, z: 7 }, spawn = { x: 1.3, z: 0 };

  it("is named Trail 14", () => {
    expect(TRAIL_NAME).toBe("Trail 14");
  });

  it("stands 1.75 m off the bed at the entrance, on the side farther from the board", () => {
    expect(trailSignSite(graph(1), board)).toEqual({ x: 8, z: -1.75 });
    expect(trailSignSite(graph(1), { x: 2, z: -7 })).toEqual({ x: 8, z: 1.75 });
  });

  it("carries one plank, across the line to the player and pointing away from the bed", () => {
    const post = trailSign(graph(1), board, spawn);
    expect({ x: post.x, z: post.z }).toEqual({ x: 8, z: -1.75 });
    expect(post.arms).toHaveLength(1);
    const arm = post.arms[0]!;
    expect(arm.names).toEqual(["Trail 14"]);
    expect(arm.ranks).toEqual([0]);
    expect(arm.dx).toBeCloseTo(-0.2527158154000624, 9);
    expect(arm.dz).toBeCloseTo(-0.96754055038881, 9);
    // Across the line from the post to the player: the plank's face is toward them.
    const len = Math.hypot(spawn.x - post.x, spawn.z - post.z);
    expect(arm.dx * ((spawn.x - post.x) / len) + arm.dz * ((spawn.z - post.z) / len)).toBeCloseTo(0, 9);
  });

  it("joins the junction posts as the last post", () => {
    const g = graph(2);
    const named = [{ name: "Summit", x: 200, z: 0 }];
    const posts = allSignPosts(g, named, board, spawn);
    expect(posts).toHaveLength(3);
    expect(posts.slice(0, 2)).toEqual(signPosts(g, named));
    expect(posts[2]).toEqual(trailSign(g, board, spawn));
  });
});
