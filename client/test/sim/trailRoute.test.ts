import { describe, expect, it } from "vitest";
import { route, stemNodes, stemProgress, homeDistances, forksOf, guideWalk, pathLength, GUIDE_MIN, GUIDE_MAX } from "../../src/sim/trailRoute.js";
import { graph } from "./helpers/registerGraph.js";
import type { TrailEdge, TrailGraph } from "../../src/sim/trail.js";
import { nextRandom } from "../../src/sim/types.js";

/** A diamond: 0 → 1 → 3 and 0 → 2 → 3 are exactly the same length. */
function diamond(): TrailGraph {
  const nodes = [
    { x: 0, z: 0, h: 0, u: 0 }, { x: 10, z: 10, h: 0, u: 0 }, { x: 10, z: -10, h: 0, u: 0 }, { x: 20, z: 0, h: 0, u: 0 },
  ];
  const edge = (a: number, b: number): TrailEdge =>
    ({ a, b, kind: "loop", profile: new Float64Array([0, 0]), progress0: 0, progress1: 0 });
  return {
    nodes, edges: [edge(0, 1), edge(1, 3), edge(0, 2), edge(2, 3)], trailhead: { x: 0, z: 0, u: 0 }, summit: 3,
    stem: [0, 1], loops: [], features: [], stemLen: 28.28, fallbacks: 0,
    forks: [], homeDist: [0, 14.14, 14.14, 28.28], shortestHome: 28.28,
  };
}

describe("stemNodes", () => {
  it("reads the stem as a node chain, pad first, crest last", () => {
    expect(stemNodes(graph(2))).toEqual([0, 1, 2]);
  });
});

describe("route", () => {
  it("walks the stem from the pad to the crest and back", () => {
    expect(route(graph(1), 0, 2)).toEqual([0, 1, 2]);
    expect(route(graph(1), 2, 0)).toEqual([2, 1, 0]);
  });

  it("takes the loop when it is shorter than going round by the stem", () => {
    // 3 → 4 → 2 is 60 + 53.9 m; 3 → 1 → 2 would be 53.9 + 100 m.
    expect(route(graph(1), 3, 2)).toEqual([3, 4, 2]);
  });

  it("breaks an exact tie toward the lower node index", () => {
    expect(route(diamond(), 0, 3)).toEqual([0, 1, 3]);
  });

  it("is a single node from a node to itself, and empty when unreachable", () => {
    expect(route(graph(0), 1, 1)).toEqual([1]);
    const g = graph(0);
    g.nodes.push({ x: 999, z: 999, h: 0, u: 0 });
    expect(route(g, 0, 7)).toEqual([]);
  });

  it("memoises per graph, so the same question returns the same array", () => {
    const g = graph(1);
    expect(route(g, 0, 2)).toBe(route(g, 0, 2));
    expect(route(g, 0, 2)).not.toBe(route(graph(1), 0, 2));
  });
});

describe("stemProgress", () => {
  // The hand graph's stem is a straight 200 m along +x: pad (0,0), middle (100,0), crest (200,0).
  it("is 0 at the crest, 1 at the pad and 0.5 at the middle node", () => {
    const g = graph(1);
    expect(stemProgress(g, 200, 0)).toBeCloseTo(0, 9);
    expect(stemProgress(g, 0, 0)).toBeCloseTo(1, 9);
    expect(stemProgress(g, 100, 0)).toBeCloseTo(0.5, 9);
  });

  it("projects a point beside the stem onto it", () => {
    // Loop node 3 at (120, 50) is nearest the stem at (120, 0): 120 m from the pad of 200.
    expect(stemProgress(graph(1), 120, 50)).toBeCloseTo(0.4, 9);
  });

  it("clamps past either end", () => {
    expect(stemProgress(graph(1), 300, 0)).toBeCloseTo(0, 9);
    expect(stemProgress(graph(1), -50, 10)).toBeCloseTo(1, 9);
  });

  it("reads 0 for a degenerate stem with no edges", () => {
    const g = { ...graph(0), stem: [] };
    expect(stemProgress(g, 50, 0)).toBe(0);
  });
});

describe("homeDistances", () => {
  it("is 0 at the pad and the arc length along the stem elsewhere", () => {
    const g = graph(0);
    expect(homeDistances(g.nodes, g.edges)).toEqual([0, 100, 200, Infinity, Infinity, Infinity, Infinity]);
  });

  it("takes the shorter way when a loop offers one", () => {
    // Node 3 is 100 + 53.85 by the stem then the loop; node 4 is 100 + 53.85 + 60 that
    // way, or 200 + 53.85 via the crest — the loop wins.
    const g = graph(1);
    const d = homeDistances(g.nodes, g.edges);
    expect(d[3]).toBeCloseTo(100 + Math.sqrt(20 * 20 + 50 * 50), 6);
    expect(d[4]).toBeCloseTo(100 + Math.sqrt(20 * 20 + 50 * 50) + 60, 6);
  });
});

describe("forksOf", () => {
  it("lists every node of degree three or more, ascending", () => {
    expect(forksOf(graph(0).nodes.length, graph(0).edges)).toEqual([]);
    // graph(1) has one loop off node 1 rejoining at node 2: node 1 is degree
    // 3 (stem in, stem out, loop out), but node 2 is only degree 2 (stem in,
    // loop in) until the second loop (graph(2)) also rejoins there.
    expect(forksOf(graph(1).nodes.length, graph(1).edges)).toEqual([1]);
    expect(forksOf(graph(2).nodes.length, graph(2).edges)).toEqual([1, 2]);
  });
});

/** A ladder: a stem 0→1→2→3 (three 100 m edges, summit 3) and a parallel strand
 * 4→5 beside it (4 at (100,80), 5 at (200,80), 100 m apart), joined to the stem by
 * two 80 m rungs, 1–4 and 5–2. Exactly two crest-to-pad walks exist: the stem
 * itself, 3→2→1→0 at 300 m, and the way round the strand, 3→2→5→4→1→0 at
 * 100+80+100+80+100 = 460 m. */
function ladder(): TrailGraph {
  const nodes = [
    { x: 0, z: 0, h: 0, u: 0 }, { x: 100, z: 0, h: 0, u: 0 }, { x: 200, z: 0, h: 0, u: 0 }, { x: 300, z: 0, h: 0, u: 0 },
    { x: 100, z: 80, h: 0, u: 0 }, { x: 200, z: 80, h: 0, u: 0 },
  ];
  const edge = (a: number, b: number, kind: TrailEdge["kind"]): TrailEdge =>
    ({ a, b, kind, profile: new Float64Array([0, 0]), progress0: 0, progress1: 0 });
  const edges = [edge(0, 1, "stem"), edge(1, 2, "stem"), edge(2, 3, "stem"), edge(1, 4, "rung"), edge(4, 5, "strand"), edge(5, 2, "rung")];
  const homeDist = homeDistances(nodes, edges);
  return {
    nodes, edges, trailhead: { x: 0, z: 0, u: 0 }, summit: 3, stem: [0, 1, 2], loops: [], features: [], stemLen: 300, fallbacks: 0,
    forks: forksOf(nodes.length, edges), homeDist, shortestHome: homeDist[3]!,
  };
}

describe("guideWalk", () => {
  it("returns a crest-to-pad walk in the band when one exists, never repeating an edge", () => {
    const g = ladder();
    const rng = { rngSeed: 7 };
    const walk = guideWalk(g, () => nextRandom(rng), 1.5, 1.6, 64);
    expect(walk.path[0]).toBe(3);
    expect(walk.path[walk.path.length - 1]).toBe(0);
    expect(walk.inBand).toBe(true);
    expect(walk.length).toBeCloseTo(460, 6);
    expect(walk.path).toEqual([3, 2, 5, 4, 1, 0]);
  });

  it("falls back to the longest walk under the cap, then to the shortest path", () => {
    const g = ladder();
    const rng = { rngSeed: 7 };
    // Nothing in [2, 2.5] × 300 exists (the longest simple walk is 460 = 1.53×):
    // the longest under the cap is returned, out of band.
    const under = guideWalk(g, () => nextRandom(rng), 2, 2.5, 16);
    expect(under.inBand).toBe(false);
    expect(under.length).toBeCloseTo(460, 6);
    // A band the stem itself is over: [0.5, 0.9] × 300 caps at 270, so BOTH
    // walks are abandoned mid-walk (300 and 460 each pass the cap), `best` is
    // never set, and the shortest path comes back instead. A band of
    // [1.1, 1.2] would NOT reach here — 300 is under that cap, so the stem walk
    // is kept as the longest under it and returned by the branch above.
    const shortest = guideWalk(g, () => nextRandom(rng), 0.5, 0.9, 16);
    expect(shortest.inBand).toBe(false);
    expect(shortest.path).toEqual([3, 2, 1, 0]);
    expect(shortest.length).toBeCloseTo(300, 6);
  });

  it("is deterministic in the RNG", () => {
    const g = ladder();
    // The RNG STATE is hoisted, not allocated inside the closure: with
    // `() => nextRandom({ rngSeed: 99 })` every call starts from the same
    // state, so `rand` is a constant and the walk could not vary no matter
    // what `guideWalk` did with it.
    const ra = { rngSeed: 99 };
    const a = guideWalk(g, () => nextRandom(ra), GUIDE_MIN, GUIDE_MAX, 8);
    const rb = { rngSeed: 99 };
    const b = guideWalk(g, () => nextRandom(rb), GUIDE_MIN, GUIDE_MAX, 8);
    expect(a).toEqual(b);
    // NO SECOND SEED HERE. A different seed cannot give a different answer on
    // the ladder: it offers exactly two crest-to-pad walks, only one of which
    // (460 m = 1.53 × shortestHome) lands in [GUIDE_MIN, GUIDE_MAX], and
    // `guideWalk` returns the first try that lands in band. Every seed probed
    // finds it on the first try, so "a different seed walks differently" is a
    // claim for a graph with more than two ways down, not for this fixture.
  });

  it("measures a path's length by arc", () => {
    expect(pathLength(ladder(), [3, 2, 1, 0])).toBeCloseTo(300, 6);
  });

  it("visits no node twice, even where a loop off a hub would let it", () => {
    // A four-way hub (1) between the crest (4) and the pad (0), with a loop
    // 1→2→3→1 hanging off it. Walking the loop and coming back through the
    // hub repeats no EDGE — 4→1→2→3→1→0 is 100 + 64 + 80 + 64 + 100 = 408 m,
    // 2.04 × the 200 m shortest and squarely in band — but it stands on the
    // hub twice, and the cut needs one edge into every fork and one out. So
    // the walk refuses it: at 3 the only onward edge leads to a node already
    // on the walk, that try dies, and the one crest-to-pad walk left is the
    // 200 m stem, out of band.
    const nodes = [
      { x: 0, z: 0, h: 0, u: 0 }, { x: 100, z: 0, h: 0, u: 0 }, { x: 150, z: 40, h: 0, u: 0 },
      { x: 150, z: -40, h: 0, u: 0 }, { x: 200, z: 0, h: 0, u: 0 },
    ];
    const edge = (a: number, b: number): TrailEdge =>
      ({ a, b, kind: "loop", profile: new Float64Array([0, 0]), progress0: 0, progress1: 0 });
    const edges = [edge(0, 1), edge(1, 2), edge(2, 3), edge(3, 1), edge(1, 4)];
    const homeDist = homeDistances(nodes, edges);
    const g: TrailGraph = {
      nodes, edges, trailhead: { x: 0, z: 0, u: 0 }, summit: 4, stem: [0, 4], loops: [], features: [], stemLen: 200,
      fallbacks: 0, forks: forksOf(nodes.length, edges), homeDist, shortestHome: homeDist[4]!,
    };
    expect(g.forks).toEqual([1]);
    for (const seed of [1, 7, 99, 2024]) {
      const rng = { rngSeed: seed };
      const walk = guideWalk(g, () => nextRandom(rng), GUIDE_MIN, GUIDE_MAX, 64);
      expect(new Set(walk.path).size, `seed ${seed}`).toBe(walk.path.length);
      expect(walk.path, `seed ${seed}`).toEqual([4, 1, 0]);
      expect(walk.inBand, `seed ${seed}`).toBe(false);
    }
  });
});
