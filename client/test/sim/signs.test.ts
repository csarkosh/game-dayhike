import { describe, expect, it } from "vitest";
import { SIGN_POST_OFFSET, TRAILHEAD_LABEL, signPosts } from "../../src/sim/signs.js";
import { trailDistance, TRAIL_BED_HALF } from "../../src/sim/trail.js";
import { graph } from "./helpers/registerGraph.js";

const sites = (g: ReturnType<typeof graph>) => [
  { name: "the summit", x: 200, z: 0 },
  ...(g.loops.length >= 1 ? [{ name: "the meadow", x: 150, z: 50 }] : []),
];

describe("signPosts", () => {
  it("stands one post at every junction, with one arm per branch naming what lies down it", () => {
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
    expect(byFirst.get(TRAILHEAD_LABEL)!.names).toEqual([TRAILHEAD_LABEL]);
    expect(byFirst.get("the summit")!.names).toEqual(["the summit", "the meadow"]);
    expect(byFirst.get("the meadow")!.names).toEqual(["the meadow", "the summit"]);
    expect(byFirst.get("the meadow")!.dz).toBeGreaterThan(0.7); // the loop leaves toward +z
    expect(byFirst.get(TRAILHEAD_LABEL)!.dx).toBeCloseTo(-1, 6);
  });

  it("names every site a branch reaches, nearest first", () => {
    const g = graph(2);
    const posts = signPosts(g, [{ name: "the summit", x: 200, z: 0 }, { name: "the lower meadow", x: 150, z: 50 }, { name: "the upper meadow", x: 150, z: -50 }]);
    const atJunction = posts.find((p) => Math.abs(p.x - 100) < 3)!;
    // Down the stem from node 1 everything is reachable: the summit and, round the loops, both meadows.
    const stem = atJunction.arms.find((a) => a.dx > 0.99)!;
    expect(stem.names).toEqual(["the summit", "the lower meadow", "the upper meadow"]);
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
