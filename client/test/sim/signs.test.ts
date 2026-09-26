import { describe, expect, it } from "vitest";
import { SIGN_POST_OFFSET, SUMMIT_LABEL, TRAILHEAD_LABEL, signPostSites, signPosts } from "../../src/sim/signs.js";
import { trailDistance, TRAIL_BED_HALF, type TrailEdge, type TrailGraph } from "../../src/sim/trail.js";
import { graph } from "./helpers/registerGraph.js";

const sites = (g: ReturnType<typeof graph>) => [
  { name: SUMMIT_LABEL, x: 200, z: 0 },
  ...(g.loops.length >= 1 ? [{ name: "the meadow", x: 150, z: 50 }] : []),
];

describe("signPosts", () => {
  it("labels the ends of the trail Trailhead and Summit", () => {
    expect(TRAILHEAD_LABEL).toBe("Trailhead");
    expect(SUMMIT_LABEL).toBe("Summit");
  });

  it("stands one post at every junction, and on a loop both arms of the fork name the loop's place", () => {
    const g = graph(1);
    const posts = signPosts(g, sites(g));
    // Only node 1 has three branches: the loop rejoins at the summit node,
    // whose degree is two.
    expect(posts).toHaveLength(1);
    const atJunction = posts.find((p) => Math.abs(p.x - 100) < SIGN_POST_OFFSET + 0.01 && Math.abs(p.z) < SIGN_POST_OFFSET + 0.01)!;
    expect(atJunction.arms).toHaveLength(3);
    // Keyed by the nearest name: the loop rejoins the stem, so the stem arm
    // also reaches the meadow and the loop arm also reaches the summit.
    const byFirst = new Map(atJunction.arms.map((a) => [a.names[0], a]));
    expect(byFirst.get("Trailhead")!.names).toEqual(["Trailhead"]);
    expect(byFirst.get("Summit")!.names).toEqual(["Summit", "the meadow"]);
    expect(byFirst.get("the meadow")!.names).toEqual(["the meadow", "Summit"]);
    expect(byFirst.get("the meadow")!.dz).toBeGreaterThan(0.7); // the loop leaves toward +z
    expect(byFirst.get("Trailhead")!.dx).toBeCloseTo(-1, 6);
  });

  it("names at most two places per arm, the nearest by trail distance", () => {
    const g = graph(2);
    const posts = signPosts(g, [
      { name: "Summit", x: 200, z: 0 },
      { name: "the lower meadow", x: 150, z: 50 },
      { name: "the upper meadow", x: 150, z: -50 },
    ]);
    expect(posts).toHaveLength(2);
    const atFork = posts.find((p) => Math.abs(p.x - 100) < 3)!;
    const stem = atFork.arms.find((a) => a.dx > 0.99)!;
    expect(stem.names).toEqual(["Summit", "the lower meadow"]);
    for (const p of posts) for (const a of p.arms) expect(a.names.length).toBeLessThanOrEqual(2);
  });

  it("breaks a tie in trail distance toward the lower node, whichever edge is walked first", () => {
    // A fork at node 1 (a stub spur to node 2 makes it a junction); past node
    // 3 the trail splits into two equal branches. The edge to node 5 is
    // listed first, so node 5 is found first, yet node 4 (the lower id, at
    // exactly the same distance) takes the arm's second name.
    const node = (x: number, z: number) => ({ x, z, h: 0, u: 0 });
    const edge = (a: number, b: number): TrailEdge => ({ a, b, kind: "stem", profile: new Float64Array([0, 0]), progress0: 0, progress1: 0 });
    const g = {
      nodes: [node(0, 0), node(100, 0), node(100, 50), node(200, 0), node(250, -50), node(250, 50)],
      edges: [edge(0, 1), edge(1, 2), edge(1, 3), edge(3, 5), edge(3, 4)],
    } as unknown as TrailGraph;
    const posts = signPosts(g, [
      { name: "the bridge", x: 200, z: 0 },
      { name: "North Lake", x: 250, z: 50 },
      { name: "South Lake", x: 250, z: -50 },
    ]);
    // Nodes 1 and 3 are both junctions; the fork at node 1 is the one read.
    expect(posts).toHaveLength(2);
    const out = posts.find((p) => Math.abs(p.x - 100) < 3)!.arms.find((a) => a.dx > 0.99)!;
    expect(out.names).toEqual(["the bridge", "South Lake"]);
  });

  it("stands the posts where signPostSites says, names or no names", () => {
    const g = graph(2);
    const sites = signPostSites(g);
    expect(sites.map((s) => s.node)).toEqual([1, 2]);
    const posts = signPosts(g, [{ name: "Summit", x: 200, z: 0 }]);
    expect(posts.map((p) => ({ x: p.x, z: p.z }))).toEqual(sites.map((s) => ({ x: s.x, z: s.z })));
  });

  it("counts the trailhead as a place like any other, and nearer places win over it", () => {
    const g = graph(2);
    const posts = signPosts(g, [
      { name: "Summit", x: 200, z: 0 },
      { name: "the lower meadow", x: 150, z: 50 },
      { name: "the upper meadow", x: 150, z: -50 },
    ]);
    // Both loops rejoin at the crest, so it is a junction too.
    const atCrest = posts.find((p) => Math.abs(p.x - 200) < 3)!;
    expect(atCrest.arms).toHaveLength(3);
    // Straight down the stem the trailhead is 100 m off; each meadow is 54 m
    // round its loop from node 1, so they are the two names.
    const down = atCrest.arms.find((a) => a.dx < -0.99)!;
    expect(down.names).toEqual(["the lower meadow", "the upper meadow"]);
    const lower = atCrest.arms.find((a) => a.dz > 0.9)!;
    expect(lower.names).toEqual(["the lower meadow", "the upper meadow"]);
    const upper = atCrest.arms.find((a) => a.dz < -0.9)!;
    expect(upper.names).toEqual(["the upper meadow", "the lower meadow"]);
    // From the fork, the arm back toward the pad reads the trailhead alone.
    const atFork = posts.find((p) => Math.abs(p.x - 100) < 3)!;
    expect(atFork.arms.find((a) => a.dx < -0.99)!.names).toEqual(["Trailhead"]);
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
