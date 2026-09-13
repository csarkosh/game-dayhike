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
  segmentSegmentDistanceSq, segmentDistance, TRAIL_HARD_SLOPE_MAX, TRAIL_EDGE_MIN_GAP,
  type TrailGraph,
} from "../../src/sim/trail.js";
import { LANDMARK_DISC_RADIUS } from "../../src/sim/landmarks.js";
import {
  PEAK_INLAND_MIN, PEAK_INLAND_MAX, PEAK_RISE_MAX, STEM_LEN_MIN,
  planFeatures, LOOP_JUNCTION_GAP, LOOP_LEN_MIN, LOOP_LEN_MAX, FEATURE_SPACING,
} from "../../src/sim/features.js";
import { TRAIL_GRID_CELL } from "../../src/sim/trailGrid.js";
import type { TerrainSample } from "../../src/sim/terrain.js";

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

const ROAD_X = -250;
/**
 * A synthetic world: a gentle plane rising inland (grade 0.1) with a steep
 * ridge across it at u ∈ [400, 440] (grade 2) broken by a gap at z ∈ [−60, −20],
 * and a knoll 40 m high at (u 700, z 300).
 */
function frame(seed: number): BuildFrame {
  void seed;
  const sample = (x: number, z: number): TerrainSample => {
    const u = x - ROAD_X;
    let h = 20 + 0.1 * u, dx = 0.1, dz = 0;
    if (u >= 400 && u <= 440 && !(z >= -60 && z <= -20)) { h += 2 * (u - 400); dx += 2; }
    const kx = u - 700, kz = z - 300, k2 = kx * kx + kz * kz;
    // A knoll: h += 40·s², s = 1 − k²/R²; ∂h/∂kx = 80·s·(−2kx/R²).
    if (k2 < 150 * 150) { const s = 1 - k2 / (150 * 150); h += 40 * s * s; dx += -160 * s * kx / (150 * 150); dz += -160 * s * kz / (150 * 150); }
    return { h, dx, dz };
  };
  return {
    roadCenterX: () => ROAD_X,
    sample,
    treeDensity: (x, z) => (x - ROAD_X > 600 && z > 100 && Math.hypot(x - ROAD_X - 700, z - 300) > 160 ? 1 : 0.5),
    boulderDensity: (x, z) => (Math.hypot(x - ROAD_X - 500, z - 200) < 60 ? 0.8 : 0),
    // This world's boulders do not come from a slope gate, so no disc may be
    // skipped on the grid's gradients: 0 claims nothing is ever exactly zero.
    boulderSlopeMin: 0,
  };
}
/** The ridge world: `frame(1)`, unchanged. */
function ridgeFrame(): BuildFrame {
  return frame(1);
}
/** A gentle ripple superimposed on the base grade: amplitude and period small
 * enough to stay well clear of every slope cap this fixture must satisfy, but
 * with real curvature — unlike a bare incline (an exact plane, zero
 * deviation from any chord), `simplify`'s Douglas-Peucker pass has a reason
 * to KEEP an intermediate stem node roughly every quarter period. Used only
 * by `flatFrame`/`shortStemFrame` (2026-09-11 — see their own comments). */
const RIPPLE_AMP = 8;
const RIPPLE_PERIOD = 250;
function ripple(u: number): { dh: number; ddx: number } {
  const w = (2 * Math.PI) / RIPPLE_PERIOD;
  return { dh: RIPPLE_AMP * Math.sin(w * u), ddx: RIPPLE_AMP * w * Math.cos(w * u) };
}
/** The plain plane, no ridge and no knoll: grade 0.05 alone, uniform tree
 * cover, the same boulder field at (500, 200), with the ripple above added
 * to the base incline.
 *
 * Grade lowered from 0.1 to 0.05 here, and the ripple added (2026-09-11):
 * this fixture's grade was pinned at 0.1, flat, before the loop feature
 * stage existed.
 *
 * Bug 3: POND_SLOPE_MAX is 0.08 — a uniform 0.1 grade admits no pond
 * candidate at all (every disc cell reads exactly 0.1 > 0.08), so seed
 * 0x5eed's plan (which draws a pond first) could never build its full plan
 * here, no matter how the routing itself is written. 0.05 clears
 * POND_SLOPE_MAX with margin and stays well under MEADOW_SLOPE_MAX (0.12).
 *
 * Bug 4: a bare incline is an exact PLANE — every stem node between two
 * bends collapses into one edge under `simplify`'s tolerance, because there
 * is truly zero deviation from any chord. On this fixture the routed stem
 * needed no turn for ~760 m (measured: `stemAcc` read `[0, 763, 817, ...]`),
 * so a loop's junction search — which only ever REUSES an existing stem
 * node — had exactly two nodes to choose from across most of
 * the stem's length, snapping A and B hundreds of metres from the feature
 * itself; both half-loops then routed through the same direct corridor and
 * were rejected as 100% overlapping (measured directly: seed 0x5eed, loops 0
 * and 2, every candidate's h2 was rejected at `shared/total = 4/4`). Real
 * terrain never collapses this way — the 227-seed sweep's stems carry 6 to
 * ~90 nodes because real ground always has some curvature the simplifier has
 * to respect — so this is a defect of an unrealistically perfect plane, not
 * of the loop algorithm; the ripple (amplitude 8 m, period 250 m) restores
 * the kind of curvature real terrain always has. Its own worst-case slope
 * contribution is RIPPLE_AMP · 2π / RIPPLE_PERIOD ≈ 0.201, but that peaks
 * only very close to the ripple's zero-crossings — a candidate disc centred
 * near a crest or trough (where a real loop candidate's flattest-first score
 * pulls it) reads close to the 0.05 base grade alone; measured directly
 * after this change: every one of the four new loop tests passes, with
 * candidate counts in the dozens at every band. Nothing else this fixture's
 * pre-existing tests check depends on the exact grade or on the
 * plane being exact — the peak's band is a fixed u-range, the stem-length
 * floor (STEM_LEN_MIN * 0.8) has slack either way, and the crest still reads
 * as the highest node (the peak's 50–80 m of rise dwarfs an 8 m ripple). */
function flatFrame(): BuildFrame {
  return {
    roadCenterX: () => ROAD_X,
    sample: (x) => {
      const u = x - ROAD_X;
      const r = ripple(u);
      return { h: 20 + 0.05 * u + r.dh, dx: 0.05 + r.ddx, dz: 0 };
    },
    treeDensity: () => 0.5,
    boulderDensity: (x, z) => (Math.hypot(x - ROAD_X - 500, z - 200) < 60 ? 0.8 : 0),
    boulderSlopeMin: 0,
  };
}
/** The flat frame walled off at |z| >= 59: a strip narrower than two
 * LOOP_LATERAL_MIN (60 + 60 = 120 total), so no loop candidate's lateral
 * offset ever fits on either side of the pad→crest axis — every loop kind is
 * dropped, and the stem (which runs close to z = 0) still gets through.
 *
 * 50 -> 59 (2026-09-11): at 50 the scenery pass (the
 * stand/talus, unrelated to loops, still real code this fixture also drives)
 * could find no candidate at all and threw — the usable band clear of the
 * trail is [sceneryClear, WALL_Z] = [37, WALL_Z] (LANDMARK_DISC_RADIUS +
 * TRAIL_CORRIDOR_HALF), only 13 m wide at 50, narrower than
 * LANDMARK_CANDIDATE_STRIDE's own 32 m step (4 grid cells) — no sampled
 * candidate cell could ever land in it. 59 still blocks every loop (< 60)
 * and widens the band to 22 m, enough in practice (measured: the loop test
 * now finds a stand and a talus and every loop is still dropped). */
function narrowFrame(): BuildFrame {
  const WALL_Z = 59;
  return {
    roadCenterX: () => ROAD_X,
    sample: (x, z) => {
      const az = Math.abs(z);
      if (az <= WALL_Z) return { h: 20 + 0.1 * (x - ROAD_X), dx: 0.1, dz: 0 };
      const over = az - WALL_Z;
      return { h: 20 + 0.1 * (x - ROAD_X) + 5 * over, dx: 0.1, dz: z >= 0 ? 5 : -5 };
    },
    treeDensity: () => 0.5,
    boulderDensity: (x, z) => (Math.hypot(x - ROAD_X - 500, z - 200) < 60 ? 0.8 : 0),
    boulderSlopeMin: 0,
  };
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
    // TRAIL_EDGE_MIN_GAP of walking apart.
    const near = (from: number): Map<number, number> => {
      const d = new Map<number, number>([[from, 0]]);
      for (;;) {
        let moved = false;
        for (const e of g.edges) {
          const L = Math.hypot(g.nodes[e.b]!.x - g.nodes[e.a]!.x, g.nodes[e.b]!.z - g.nodes[e.a]!.z);
          for (const [p, q] of [[e.a, e.b], [e.b, e.a]] as const) {
            const dp = d.get(p);
            if (dp === undefined || dp + L >= TRAIL_EDGE_MIN_GAP) continue;
            if ((d.get(q) ?? Infinity) > dp + L) { d.set(q, dp + L); moved = true; }
          }
        }
        if (!moved) break;
      }
      return d;
    };
    const within = new Map<number, Map<number, number>>();
    for (let n = 0; n < g.nodes.length; n++) within.set(n, near(n));
    let pairs = 0;
    for (let i = 0; i < g.edges.length; i++) {
      for (let j = i + 1; j < g.edges.length; j++) {
        const e = g.edges[i]!, f = g.edges[j]!;
        const linked = [e.a, e.b].some((p) => [f.a, f.b].some((q) => within.get(p)!.has(q)));
        if (linked) continue;
        const a = g.nodes[e.a]!, b = g.nodes[e.b]!, c = g.nodes[f.a]!, d = g.nodes[f.b]!;
        expect(segmentSegmentDistanceSq(a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z), `edges ${i},${j}`).toBeGreaterThanOrEqual(TRAIL_EDGE_MIN_GAP * TRAIL_EDGE_MIN_GAP - 1e-6);
        pairs++;
      }
    }
    // A single stem chain has no branching, so non-adjacent pairs are scarce
    // on this small synthetic world — just assert the invariant holds on
    // whatever pairs exist; the 227-seed sweep (`trailBed.test.ts`) is the
    // real gate on how many that is on real terrain.
    void pairs;
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
  // reach — which on this fixture is a knife edge: scanning `shortStemFrame`'s
  // wall from u = 420 to 900 in 20 m steps, a hub forms at exactly 460, 600 and
  // 720 and at no other value. Moving the wall onto one of those would be
  // fitting the fixture to the assertion. Hubs are real and are asserted on
  // REAL terrain by a later test instead (at least 3 of the 227-seed sweep;
  // measured at 4 with the current code).
});
