import { describe, expect, it } from "vitest";
import { SIGN_POST_OFFSET, SUMMIT_LABEL, TRAILHEAD_LABEL, signPosts } from "../../src/sim/signs.js";
import { trailDistance, TRAIL_BED_HALF } from "../../src/sim/trail.js";
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

  it("names at most two places per arm, the nearest by trail distance, ties to the lower node", () => {
    const g = graph(2);
    const posts = signPosts(g, [
      { name: "Summit", x: 200, z: 0 },
      { name: "the lower meadow", x: 150, z: 50 },
      { name: "the upper meadow", x: 150, z: -50 },
    ]);
    expect(posts).toHaveLength(2);
    const atFork = posts.find((p) => Math.abs(p.x - 100) < 3)!;
    // Down the stem from node 1 everything is reachable; the two meadows
    // (read at nodes 3 and 5) are the same distance round their loops, and
    // node 3's is taken.
    const stem = atFork.arms.find((a) => a.dx > 0.99)!;
    expect(stem.names).toEqual(["Summit", "the lower meadow"]);
    for (const p of posts) for (const a of p.arms) expect(a.names.length).toBeLessThanOrEqual(2);
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
