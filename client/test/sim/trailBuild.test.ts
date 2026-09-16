/**
 * The builder on a world whose shape is known: the ridge with one gap and the
 * knoll are placed by hand, so what the search does with them is legible. The
 * REAL-terrain gate on the same code is `trailBed.test.ts` — the fine check
 * measures the composed field, and only a scan over hundreds of seeds says
 * whether it holds.
 */
import { describe, it, expect } from "vitest";
import { buildTrail, type BuildFrame } from "../../src/sim/trailBuild.js";
import {
  segmentDistance, TRAIL_HARD_SLOPE_MAX, TRAIL_EDGE_MIN_GAP,
  type TrailGraph,
} from "../../src/sim/trail.js";
import { closeNonAdjacentEdgePairs } from "./helpers/edgeGap.js";
import { LANDMARK_DISC_RADIUS } from "../../src/sim/landmarks.js";
import {
  PEAK_INLAND_MIN, PEAK_INLAND_MAX, PEAK_RISE_MAX, STEM_LEN_MIN,
  planFeatures, LOOP_JUNCTION_GAP, LOOP_LEN_MIN, LOOP_LEN_MAX, FEATURE_SPACING,
} from "../../src/sim/features.js";
import { TRAIL_GRID_CELL } from "../../src/sim/trailGrid.js";
import { ROAD_X, ridgeFrame, flatFrame, narrowFrame } from "./helpers/buildFrames.js";

/** The `progress0` of the stem edge whose `a === n`, or `progress1` of the one
 * whose `b === n` — a stem node's own progress scalar, read back off the
 * edges it terminates rather than carried separately. */
function stemProgressOfNode(graph: TrailGraph, n: number): number {
  for (const ei of graph.stem) {
    const e = graph.edges[ei]!;
    if (e.a === n) return e.progress0;
    if (e.b === n) return e.progress1;
  }
  throw new Error(`node ${n} is not a stem node`);
}

/** An edge's own XZ length. */
function edgeLen(graph: TrailGraph, ei: number): number {
  const e = graph.edges[ei]!;
  const a = graph.nodes[e.a]!, b = graph.nodes[e.b]!;
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** BFS over exactly the given edge ids: true if `from` reaches `to`. */
function reaches(graph: TrailGraph, edges: readonly number[], from: number, to: number): boolean {
  const adj = new Map<number, number[]>();
  for (const ei of edges) {
    const e = graph.edges[ei]!;
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(e.b);
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(e.a);
  }
  const seen = new Set<number>([from]);
  const stack = [from];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n === to) return true;
    for (const m of adj.get(n) ?? []) if (!seen.has(m)) { seen.add(m); stack.push(m); }
  }
  return seen.has(to);
}

/** The ordered node path a loop's own edges make, from `from` to `to`. A loop's
 * `edges` array is its two halves concatenated, and the second half runs from
 * its junction TOWARD the turn, so the array order is not a chain — walk the
 * adjacency instead. */
function loopPath(graph: TrailGraph, edges: readonly number[], from: number, to: number): number[] {
  const adj = new Map<number, number[]>();
  for (const ei of edges) {
    const e = graph.edges[ei]!;
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(e.b);
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(e.a);
  }
  const prev = new Map<number, number>([[from, -1]]);
  const queue = [from];
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (n === to) break;
    for (const m of adj.get(n) ?? []) if (!prev.has(m)) { prev.set(m, n); queue.push(m); }
  }
  const out: number[] = [];
  for (let n = to; n !== -1; n = prev.get(n) ?? -1) out.push(n);
  out.reverse();
  return out;
}

/** The stem's node chain, pad first. */
function stemNodesOf(graph: TrailGraph): number[] {
  const out = [0];
  for (const ei of graph.stem) out.push(graph.edges[ei]!.b);
  return out;
}

/**
 * The signed WINDING NUMBER of a closed polygon about a point — the standard
 * trig-free form: count the edges that cross the point's horizontal ray,
 * signed by which way they cross, with `isLeft`'s cross product deciding which
 * side of the edge the point is on. ±1 means the polygon goes round the point
 * exactly once; 0 means it does not enclose it at all, which is what a
 * there-and-back or two halves on the same side of a disc produce.
 */
function windingAbout(poly: readonly { x: number; z: number }[], px: number, pz: number): number {
  const isLeft = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
    (b.x - a.x) * (pz - a.z) - (px - a.x) * (b.z - a.z);
  let wn = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    if (a.z <= pz) {
      if (b.z > pz && isLeft(a, b) > 0) wn++;
    } else if (b.z <= pz && isLeft(a, b) < 0) wn--;
  }
  return wn;
}

/** Every node's degree over the whole graph. */
function degreesOf(graph: TrailGraph): Map<number, number> {
  const d = new Map<number, number>();
  for (const e of graph.edges) { d.set(e.a, (d.get(e.a) ?? 0) + 1); d.set(e.b, (d.get(e.b) ?? 0) + 1); }
  return d;
}

/** Every node of degree 1 other than the trailhead (node 0). */
function deadEndsOf(graph: TrailGraph): number[] {
  const d = degreesOf(graph);
  return [...d.entries()].filter(([n, deg]) => deg === 1 && n !== 0).map(([n]) => n);
}

/** True if any edge's centreline, sampled every 2 m, crosses the ridge band
 * (u ∈ (400, 440)) outside its gap (z ∈ (−70, −10), a small margin either
 * side of the true gap [−60, −20] for sampling and grid-cell tolerance). */
function crossesRidge(g: TrailGraph, f: BuildFrame): boolean {
  for (const e of g.edges) {
    const a = g.nodes[e.a]!, b = g.nodes[e.b]!;
    const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 2));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const u = x - f.roadCenterX(z);
      if (u > 400 && u < 440 && (z <= -70 || z >= -10)) return true;
    }
  }
  return false;
}

describe("buildTrail on a synthetic world", () => {
  it("places one peak 700–1000 m inland, routes the stem to its crest, and the crest is the only dead end", () => {
    const { graph, features } = buildTrail(0x5eed, flatFrame());
    const peak = features.find((f) => f.kind === "peak")!;
    expect(peak).toBeDefined();
    expect(peak.x - flatFrame().roadCenterX(peak.z)).toBeGreaterThanOrEqual(PEAK_INLAND_MIN);
    expect(peak.x - flatFrame().roadCenterX(peak.z)).toBeLessThanOrEqual(PEAK_INLAND_MAX);
    const crest = graph.nodes[graph.summit]!;
    expect(Math.hypot(crest.x - peak.x, crest.z - peak.z)).toBeLessThanOrEqual(TRAIL_GRID_CELL * Math.SQRT2);
    const degree = new Map<number, number>();
    for (const e of graph.edges) { degree.set(e.a, (degree.get(e.a) ?? 0) + 1); degree.set(e.b, (degree.get(e.b) ?? 0) + 1); }
    const deadEnds = [...degree.entries()].filter(([n, d]) => d === 1 && n !== 0).map(([n]) => n);
    expect(deadEnds).toEqual([graph.summit]);
    expect(graph.fallbacks).toBe(0);
  });

  it("carries a monotone progress scalar along the stem, 0 at the pad and 1 at the crest", () => {
    const { graph } = buildTrail(0x5eed, flatFrame());
    let prev = 0;
    for (const ei of graph.stem) {
      const e = graph.edges[ei]!;
      expect(e.kind).toBe("stem");
      expect(e.progress0).toBeCloseTo(prev, 9);
      expect(e.progress1).toBeGreaterThan(e.progress0);
      prev = e.progress1;
    }
    expect(prev).toBeCloseTo(1, 9);
    expect(graph.edges[graph.stem[0]!]!.a).toBe(0);
    expect(graph.edges[graph.stem[graph.stem.length - 1]!]!.b).toBe(graph.summit);
    expect(graph.stemLen).toBeGreaterThanOrEqual(STEM_LEN_MIN * 0.8); // the synthetic world is small; the sweep pins the real range
  });

  it("raises the peak on the composed field: the crest node is the highest node", () => {
    const { graph } = buildTrail(0x5eed, flatFrame());
    const crest = graph.nodes[graph.summit]!;
    for (const n of graph.nodes) expect(n.h).toBeLessThanOrEqual(crest.h + 1e-9);
  });

  it("lowers the crest and retries when the first rise cannot be reached, before falling back", () => {
    // The ridge world: a wall with one gap; the peak is forced beyond it.
    const { graph, features } = buildTrail(0x5eed, ridgeFrame());
    const peak = features.find((f) => f.kind === "peak")!;
    expect(peak.height).toBeLessThanOrEqual(PEAK_RISE_MAX);
    expect(graph.fallbacks).toBe(0);
    expect(crossesRidge(graph, ridgeFrame())).toBe(false);
  });

  it("still finds a stand and a talus as scenery, and neither is a graph node", () => {
    const { graph, landmarks } = buildTrail(0x5eed, flatFrame());
    expect(landmarks.map((l) => l.type).sort()).toEqual(["stand", "talus"]);
    for (const lm of landmarks) {
      for (const n of graph.nodes) expect(Math.hypot(n.x - lm.x, n.z - lm.z)).toBeGreaterThan(LANDMARK_DISC_RADIUS);
    }
  });

  it("is deterministic", () => {
    const a = buildTrail(4242, flatFrame()), b = buildTrail(4242, flatFrame());
    expect(a.graph).toEqual(b.graph);
    expect(a.features).toEqual(b.features);
  });

  it("goes through the ridge's gap, never over the ridge", () => {
    const { graph } = buildTrail(0x5eed, ridgeFrame());
    expect(crossesRidge(graph, ridgeFrame())).toBe(false);
    // Sanity: the stem really does cross the ridge band somewhere (otherwise
    // the assertion above would pass vacuously) — it must, since the peak
    // sits at u 700-1000+TRAILHEAD_U, well past the ridge at u ∈ [400, 440].
    let crossings = 0;
    for (const e of graph.edges) {
      const a = graph.nodes[e.a]!, b = graph.nodes[e.b]!;
      const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 2));
      for (let k = 0; k <= n; k++) {
        const t = k / n, u = a.x + (b.x - a.x) * t - ROAD_X;
        if (u > 400 && u < 440) crossings++;
      }
    }
    expect(crossings).toBeGreaterThan(0);
  });

  it("holds every edge's profile under the hard cap and every non-adjacent pair TRAIL_EDGE_MIN_GAP apart", () => {
    const { graph: g } = buildTrail(0x5eed, ridgeFrame());
    for (const e of g.edges) {
      const p = e.profile, n = p.length - 1;
      const a = g.nodes[e.a]!, b = g.nodes[e.b]!;
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      for (let k = 1; k <= n; k++) expect(Math.abs(p[k]! - p[k - 1]!) / (L / n)).toBeLessThanOrEqual(TRAIL_HARD_SLOPE_MAX + 1e-9);
      expect(p[0]).toBe(a.h);
      expect(p[n]).toBe(b.h);
    }
    // Two edges of the SAME junction are exempt, and "the same junction" is
    // the trail's own measure: their nearest endpoints are less than
    // TRAIL_EDGE_MIN_GAP of walking apart. Shared with the 227-seed sweep
    // (`trailSystem.test.ts`) via `helpers/edgeGap.ts` so the exemption rule
    // stays identical on this synthetic world and on real terrain.
    const close = closeNonAdjacentEdgePairs(g, TRAIL_EDGE_MIN_GAP);
    // A single stem chain has no branching, so non-adjacent pairs are scarce
    // on this small synthetic world — just assert the invariant holds on
    // whatever pairs exist; the 227-seed sweep (`trailBed.test.ts`) is the
    // real gate on how many that is on real terrain.
    expect(close).toEqual([]);
  });

  it("routes each planned loop as two half-loops round its feature, off the stem and back onto it above", () => {
    const { graph, features } = buildTrail(0x5eed, flatFrame());
    const plan = planFeatures(0x5eed).loops;
    expect(graph.loops.length).toBe(plan.length); // the flat world has room for every loop
    for (const [i, loop] of graph.loops.entries()) {
      expect(loop.kind).toBe(plan[i]);
      const f = features.find((x) => x.id === loop.featureId)!;
      expect(f.kind).toBe(loop.kind);
      // Junctions are stem nodes, B above A by at least LOOP_JUNCTION_GAP of stem.
      const pa = stemProgressOfNode(graph, loop.junctionA), pb = stemProgressOfNode(graph, loop.junctionB);
      expect(pb - pa).toBeGreaterThanOrEqual(LOOP_JUNCTION_GAP / graph.stemLen - 1e-9);
      // Every loop edge stays outside the feature disc and inside the ring band + slack.
      for (const ei of loop.edges) {
        const e = graph.edges[ei]!;
        expect(e.kind).toBe("loop");
        for (const n of [graph.nodes[e.a]!, graph.nodes[e.b]!]) {
          const d = Math.hypot(n.x - f.x, n.z - f.z);
          expect(d).toBeGreaterThanOrEqual(f.radius - 1e-9);
        }
      }
      // The loop is connected: walking its edges from A reaches B.
      expect(reaches(graph, loop.edges, loop.junctionA, loop.junctionB)).toBe(true);
      // Loop length within budget (edge XZ lengths).
      const len = loop.edges.reduce((s, ei) => s + edgeLen(graph, ei), 0);
      expect(len).toBeGreaterThanOrEqual(LOOP_LEN_MIN * 0.5); // synthetic world; the sweep pins the real band
      expect(len).toBeLessThanOrEqual(LOOP_LEN_MAX * 1.5);
    }
  });

  it("gives loop edges the nearer junction's progress", () => {
    const { graph } = buildTrail(0x5eed, flatFrame());
    for (const loop of graph.loops) {
      const pa = stemProgressOfNode(graph, loop.junctionA), pb = stemProgressOfNode(graph, loop.junctionB);
      for (const ei of loop.edges) {
        const e = graph.edges[ei]!;
        expect(e.progress0).toBe(e.progress1);
        expect([pa, pb]).toContain(e.progress0);
      }
    }
  });

  it("goes ROUND its feature: the closed loop winds once about the centre, and the two halves take opposite ends of the disc", () => {
    // The regression cover for an earlier diagnosed defect — a "loop" whose
    // second half came back the same way it went out, enclosing nothing. It
    // stayed outside the disc, connected its own endpoints and fell inside the
    // length band, so every other case here passed it; only the builder's own
    // `enclosesPoint` gate refused it, and nothing tested that gate until this.
    // (The hub case that used to sit here was removed later — see the note at
    // the end of this describe.) The winding number is computed independently of
    // the builder, by a different algorithm: the builder uses a crossing-number
    // point-in-polygon, this uses a signed winding sum.
    // The winding sum discriminates, so this case cannot pass vacuously: a
    // square winds once about a point inside it and not at all about one beside
    // it.
    const square = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];
    expect(Math.abs(windingAbout(square, 5, 5))).toBe(1);
    expect(windingAbout(square, 20, 5)).toBe(0);
    const { graph, features } = buildTrail(0x5eed, flatFrame());
    expect(graph.loops.length).toBeGreaterThan(0);
    const stemChain = stemNodesOf(graph);
    for (const loop of graph.loops) {
      const f = features.find((x) => x.id === loop.featureId)!;
      const path = loopPath(graph, loop.edges, loop.junctionA, loop.junctionB);
      expect(path.length).toBeGreaterThan(2);
      expect(path[0]).toBe(loop.junctionA);
      expect(path[path.length - 1]).toBe(loop.junctionB);
      // Close the polygon with the stem, walked from B back down to A.
      const iA = stemChain.indexOf(loop.junctionA), iB = stemChain.indexOf(loop.junctionB);
      expect(iA).toBeGreaterThanOrEqual(0);
      expect(iB).toBeGreaterThan(iA);
      const poly = path.map((n) => graph.nodes[n]!);
      for (let i = iB - 1; i > iA; i--) poly.push(graph.nodes[stemChain[i]!]!);
      expect(Math.abs(windingAbout(poly, f.x, f.z)), `loop round feature ${f.id}`).toBe(1);

      // The two halves take opposite ends of the disc: split the path at the
      // node furthest from the A-B line (the turn, by construction) and average
      // each half's projection on the A->B direction, measured from the feature
      // centre. One half must sit below the centre and the other above it — a
      // there-and-back has both halves on the same side. (The two halves' own
      // CLOSEST approach to the centre is no use here: that is the turn itself,
      // which both halves share.)
      const a = graph.nodes[loop.junctionA]!, b = graph.nodes[loop.junctionB]!;
      let ux = b.x - a.x, uz = b.z - a.z;
      const uL = Math.hypot(ux, uz);
      ux /= uL; uz /= uL;
      let turnAt = 0, turnD = -1;
      for (const [i, n] of path.entries()) {
        const p = graph.nodes[n]!;
        const d = Math.abs((p.x - a.x) * -uz + (p.z - a.z) * ux);
        if (d > turnD) { turnD = d; turnAt = i; }
      }
      expect(turnAt).toBeGreaterThan(0);
      expect(turnAt).toBeLessThan(path.length - 1);
      const meanProj = (from: number, to: number): number => {
        let sum = 0;
        for (let i = from; i <= to; i++) {
          const p = graph.nodes[path[i]!]!;
          sum += (p.x - f.x) * ux + (p.z - f.z) * uz;
        }
        return sum / (to - from + 1);
      };
      const s1 = meanProj(0, turnAt), s2 = meanProj(turnAt, path.length - 1);
      expect(s1 * s2, `halves on opposite ends of feature ${f.id} (${s1.toFixed(1)}, ${s2.toFixed(1)})`).toBeLessThan(0);
    }
  });

  it("keeps every feature disc disjoint from every edge and every other disc", () => {
    const { graph, features } = buildTrail(0x5eed, flatFrame());
    for (const f of features) {
      for (const e of graph.edges) {
        const a = graph.nodes[e.a]!, b = graph.nodes[e.b]!;
        expect(segmentDistance(a.x, a.z, b.x, b.z, f.x, f.z)).toBeGreaterThanOrEqual(f.kind === "peak" ? 0 : f.radius - 1e-9);
      }
      for (const g of features) if (g !== f) expect(Math.hypot(f.x - g.x, f.z - g.z)).toBeGreaterThanOrEqual(FEATURE_SPACING - 1e-9);
    }
  });

  it("drops a loop whose feature has no candidate and leaves a legal world", () => {
    // The narrow world: a BOWL_Z_HALF-wide strip where no lateral offset >= LOOP_LATERAL_MIN fits.
    const { graph, features } = buildTrail(0x5eed, narrowFrame());
    expect(graph.loops.length).toBeLessThan(planFeatures(0x5eed).loops.length);
    expect(features.filter((f) => f.kind !== "peak").length).toBe(graph.loops.length);
    expect(graph.fallbacks).toBe(0);
    expect(deadEndsOf(graph)).toEqual([graph.summit]);
  });

  // DELETED 2026-09-11: "lets two loops
  // share a junction when their bands meet". The case was written for a
  // junction rule that could only REUSE one of a simplified stem's 6-33
  // vertices, where two loops landing on the same one was common. Junctions are
  // points on the stem now, split where the feature's own tangent falls, so a
  // hub needs two features' tangents to land within a split's snap
  // reach — which on a synthetic fixture is a knife edge: sweeping the wall that
  // shortens the stem from u = 420 to 900 in 20 m steps, a hub forms at exactly
  // 460, 600 and 720 and at no other value. Moving the wall onto one of those would be
  // fitting the fixture to the assertion. Hubs are real and are asserted on
  // REAL terrain by a later test instead (at least 3 of the 227-seed sweep;
  // measured at 4 with the current code).
});
