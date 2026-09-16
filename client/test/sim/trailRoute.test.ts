import { describe, expect, it } from "vitest";
import { route, stemNodes, stemProgress } from "../../src/sim/trailRoute.js";
import { graph } from "./helpers/registerGraph.js";
import type { TrailEdge, TrailGraph } from "../../src/sim/trail.js";

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
});
