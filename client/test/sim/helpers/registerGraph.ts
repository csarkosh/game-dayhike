import type { TrailGraph, TrailEdge } from "../../../src/sim/trail.js";

/** Straight stem 0→1→2 along +x (progress 0, 0.5, 1); loops 1→3→4→2 round a meadow at (150, 60) and 1→5→6→2 round one at (150, -60). */
export function graph(loops: 0 | 1 | 2): TrailGraph {
  const nodes = [
    { x: 0, z: 0, h: 0, u: 0 }, { x: 100, z: 0, h: 0, u: 0 }, { x: 200, z: 0, h: 0, u: 0 },
    { x: 120, z: 50, h: 0, u: 0 }, { x: 180, z: 50, h: 0, u: 0 },
    { x: 120, z: -50, h: 0, u: 0 }, { x: 180, z: -50, h: 0, u: 0 },
  ];
  const edge = (a: number, b: number, kind: TrailEdge["kind"], p0: number, p1: number): TrailEdge =>
    ({ a, b, kind, profile: new Float64Array([0, 0]), progress0: p0, progress1: p1 });
  const edges = [edge(0, 1, "stem", 0, 0.5), edge(1, 2, "stem", 0.5, 1)];
  const g: TrailGraph = {
    nodes, edges, trailhead: { x: 0, z: 0, u: 0 }, summit: 2, stem: [0, 1], loops: [], stemLen: 200,
    features: [{ id: 0, kind: "peak", x: 200, z: 0, radius: 300, height: 60 }], fallbacks: 0,
  };
  if (loops >= 1) {
    edges.push(edge(1, 3, "loop", 0.5, 0.5), edge(3, 4, "loop", 0.5, 0.5), edge(4, 2, "loop", 1, 1));
    g.features.push({ id: 1, kind: "meadow", x: 150, z: 60, radius: 60, height: 0 });
    g.loops.push({ kind: "meadow", featureId: 1, edges: [2, 3, 4], junctionA: 1, junctionB: 2 });
  }
  if (loops >= 2) {
    edges.push(edge(1, 5, "loop", 0.5, 0.5), edge(5, 6, "loop", 0.5, 0.5), edge(6, 2, "loop", 1, 1));
    g.features.push({ id: 2, kind: "meadow", x: 150, z: -60, radius: 60, height: 0 });
    g.loops.push({ kind: "meadow", featureId: 2, edges: [5, 6, 7], junctionA: 1, junctionB: 2 });
  }
  return g;
}
