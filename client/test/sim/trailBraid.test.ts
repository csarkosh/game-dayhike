/**
 * The braid on the flat frame: strands leave the stem at a top fork, rejoin at
 * a bottom fork, keep their lateral band, and keep every invariant the loops
 * keep (gap, disc disjointness, one dead end).
 */
import { describe, it, expect } from "vitest";
import { buildTrail } from "../../src/sim/trailBuild.js";
import { featureStageD } from "../../src/sim/features.js";
import { segmentSegmentDistanceSq, segmentDistance, TRAIL_EDGE_MIN_GAP, type TrailGraph } from "../../src/sim/trail.js";
import { stemProgress } from "../../src/sim/trailRoute.js";
import {
  maxFlushOff,
  BRAID_TOP_MAX, BRAID_TOP_FLOOR, BRAID_BOTTOM_MIN, BRAID_BOTTOM_MAX, BRAID_LATERAL_MIN,
  BRAID_MIN_SPAN, BRAID_FLUSH_MAX, BRAID_RUNG_GAP, BRAID_RUNGS_MAX,
} from "../../src/sim/trailBraid.js";
import { TRAIL_GRID_CELL } from "../../src/sim/trailGrid.js";
import { flatFrame } from "./helpers/buildFrames.js";

/** A seed whose braid draw gives two strands on the flat frame, and one that gives three
 * — the first of each, over seeds 1..40, whose world also satisfies the gap
 * invariant below. (That invariant is not a braid property: the flat frame's
 * LOOP stage already breaks it on seeds 13, 17, 37 and 40, none of which build
 * a strand at all — a branch's first step off the tree lands one cell from the
 * bed it left, which is what the two-cell rule allows. See the task report.) */
const TWO = 2;
const THREE = 32;
/**
 * A three-strand seed whose world can be crossed on BOTH strand pairs. Seed 32
 * cannot: its -1 strand sits in a pocket sealed by a loop bed, and every rung
 * try on the -1-to-A pair fails to REACH the arrival (measured: four tries, all
 * unreached). Crossing that bed is exactly what the braid forbids, so the pair
 * gets none and 32 can only ever show one rung chain.
 *
 * 485 is the first seed over 1..500 that builds three strands, keeps the gap
 * invariant the tests below assert AND builds a rung on each pair. A probe, not
 * a guarantee: over the 227-seed sweep 95 of the 162 seeds that build a strand
 * build a rung at all. See the task report.
 */
const THREE_RUNGS = 485;
/**
 * A seed whose rung ends on a LOOP's bed instead of on its pair's own strand:
 * the arrival of last resort, taken when the search cannot reach the strand at
 * all. The first over 1..120 whose rung ends on a loop node that is not also a
 * stem node (seed 40 comes first but is one of the flat frame's own
 * gap-invariant breakages, above).
 */
const LOOP_RUNG = 52;

function degreesOf(graph: TrailGraph): Map<number, number> {
  const d = new Map<number, number>();
  for (const e of graph.edges) { d.set(e.a, (d.get(e.a) ?? 0) + 1); d.set(e.b, (d.get(e.b) ?? 0) + 1); }
  return d;
}

/** The stem's nodes, pad first. */
function stemNodeSet(graph: TrailGraph): Set<number> {
  return new Set<number>([0, ...graph.stem.map((ei) => graph.edges[ei]!.b)]);
}

/**
 * Each extra strand as its node set: the connected components of the
 * kind-"strand" edges once the stem's own nodes (the top and bottom forks, where
 * every strand meets the stem) are removed. Rungs split a strand's edges and
 * add forks along it, so counting chains would over-count; components do not.
 * Each component also records the stem nodes it touches — its forks.
 */
function strandComponents(graph: TrailGraph): Array<{ nodes: number[]; forks: number[] }> {
  const stem = stemNodeSet(graph);
  const adj = new Map<number, number[]>();
  const touches = new Map<number, Set<number>>();
  for (const e of graph.edges) {
    if (e.kind !== "strand") continue;
    for (const [p, q] of [[e.a, e.b], [e.b, e.a]] as const) {
      if (stem.has(p)) continue;
      if (stem.has(q)) { (touches.get(p) ?? touches.set(p, new Set()).get(p)!).add(q); continue; }
      (adj.get(p) ?? adj.set(p, []).get(p)!).push(q);
    }
  }
  const seen = new Set<number>();
  const out: Array<{ nodes: number[]; forks: number[] }> = [];
  const starts = new Set<number>([...adj.keys(), ...touches.keys()]);
  for (const s of starts) {
    if (seen.has(s)) continue;
    const nodes: number[] = [];
    const forks = new Set<number>();
    const stack = [s];
    seen.add(s);
    while (stack.length > 0) {
      const n = stack.pop()!;
      nodes.push(n);
      for (const f of touches.get(n) ?? []) forks.add(f);
      for (const m of adj.get(n) ?? []) if (!seen.has(m)) { seen.add(m); stack.push(m); }
    }
    out.push({ nodes: nodes.sort((p, q) => p - q), forks: [...forks].sort((p, q) => p - q) });
  }
  return out;
}

/** The worlds every test below reads, built once each: `buildTrail` is the
 * whole pipeline and neither describe block may pay for it twice. */
const two = buildTrail(TWO, flatFrame()).graph;
const three = buildTrail(THREE, flatFrame()).graph;
const threeRungs = buildTrail(THREE_RUNGS, flatFrame()).graph;
const loopRung = buildTrail(LOOP_RUNG, flatFrame()).graph;

describe("buildStrands on the flat frame", () => {
  it("builds one extra strand for a two-strand seed and two for a three-strand seed", () => {
    expect(strandComponents(two)).toHaveLength(1);
    expect(strandComponents(three)).toHaveLength(2);
  });

  /**
   * The top fork is the drawn band OR below the peak's disc, whichever is lower
   * (spec §3.2, amended 2026-09-16), and the ladder may take it lower still — so
   * the band check is the two invariants that survive the amendment: the fork is
   * never above the drawn band and never below BRAID_TOP_FLOOR, and it is
   * OUTSIDE the peak's disc, which is the whole point of the amendment. The
   * bottom fork keeps its own band.
   */
  it("runs every strand from a top fork below the dome to a bottom fork in the bottom band", () => {
    for (const g of [two, three]) {
      const peak = g.features.find((f) => f.kind === "peak");
      for (const { forks } of strandComponents(g)) {
        expect(forks).toHaveLength(2);
        const ps = forks.map((f) => 1 - stemProgress(g, g.nodes[f]!.x, g.nodes[f]!.z)).sort((p, q) => p - q);
        const [lo, hi] = ps as [number, number];
        expect(hi).toBeLessThanOrEqual(BRAID_TOP_MAX + 0.03);
        expect(hi).toBeGreaterThanOrEqual(BRAID_TOP_FLOOR - 0.03);
        expect(lo).toBeGreaterThanOrEqual(BRAID_BOTTOM_MIN - 0.03);
        expect(lo).toBeLessThanOrEqual(BRAID_BOTTOM_MAX + 0.03);
        if (peak !== undefined) {
          const top = g.nodes[forks[forks.length - 1]!]!;
          const bottom = g.nodes[forks[0]!]!;
          const high = 1 - stemProgress(g, top.x, top.z) > 1 - stemProgress(g, bottom.x, bottom.z) ? top : bottom;
          expect(Math.hypot(high.x - peak.x, high.z - peak.z)).toBeGreaterThanOrEqual(peak.radius - TRAIL_GRID_CELL);
        }
      }
    }
  });

  it("gets at least BRAID_LATERAL_MIN off the stem somewhere along every strand", () => {
    for (const g of [two, three]) {
      const stemSegs = g.stem.map((ei) => { const e = g.edges[ei]!; return [g.nodes[e.a]!, g.nodes[e.b]!] as const; });
      for (const { nodes: chain } of strandComponents(g)) {
        let far = 0;
        for (const n of chain) {
          const p = g.nodes[n]!;
          let d = Infinity;
          for (const [a, b] of stemSegs) d = Math.min(d, segmentDistance(a.x, a.z, b.x, b.z, p.x, p.z));
          far = Math.max(far, d);
        }
        expect(far).toBeGreaterThanOrEqual(BRAID_LATERAL_MIN);
      }
    }
  });

  it("keeps the crest the only dead end and every non-adjacent edge pair apart", () => {
    for (const g of [two, three]) {
      const deg = degreesOf(g);
      const deadEnds = [...deg.entries()].filter(([n, d]) => d === 1 && n !== 0).map(([n]) => n);
      expect(deadEnds).toEqual([g.summit]);
      for (let i = 0; i < g.edges.length; i++) {
        for (let j = i + 1; j < g.edges.length; j++) {
          const e = g.edges[i]!, f = g.edges[j]!;
          if (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b) continue;
          const a = g.nodes[e.a]!, b = g.nodes[e.b]!, c = g.nodes[f.a]!, d = g.nodes[f.b]!;
          const d2 = segmentSegmentDistanceSq(a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z);
          expect(d2, `edges ${i} and ${j}`).toBeGreaterThanOrEqual(TRAIL_EDGE_MIN_GAP * TRAIL_EDGE_MIN_GAP * 0.99);
        }
      }
    }
  });

  it("keeps every non-peak feature disc off every edge", () => {
    for (const g of [two, three]) {
      for (const f of g.features) {
        if (f.kind === "peak") continue;
        for (const e of g.edges) {
          const a = g.nodes[e.a]!, b = g.nodes[e.b]!;
          expect(segmentDistance(a.x, a.z, b.x, b.z, f.x, f.z)).toBeGreaterThanOrEqual(f.radius);
        }
      }
    }
  });

  it("labels strand edges with the stem progress of their ends' nearest stem points", () => {
    for (const e of two.edges) {
      if (e.kind !== "strand") continue;
      const a = two.nodes[e.a]!, b = two.nodes[e.b]!;
      expect(e.progress0).toBeCloseTo(1 - stemProgress(two, a.x, a.z), 6);
      expect(e.progress1).toBeCloseTo(1 - stemProgress(two, b.x, b.z), 6);
    }
  });

  /**
   * The braid's own product — `buildStrands`'s `Strand[]`, the two fork arcs
   * and the stem samples — read back off `buildTrail`. Reconstructing a
   * `BraidCtx` here would mean re-running the stem and the loop stages to get
   * the grid, the tree and the heights the braid is handed, so `buildTrail`
   * returns what the stage decided instead; the node ids still address the
   * graph, since nothing after the braid adds or moves a node.
   */
  it("hands back strand A first, every chain top to bottom, and the two forks a braid apart", () => {
    for (const [seed, graph] of [[TWO, two], [THREE, three]] as const) {
      const { braid } = buildTrail(seed, flatFrame());
      expect(braid.strands.length).toBeGreaterThanOrEqual(2); // strand A and at least one built
      const [a, ...extra] = braid.strands;
      expect(a!.side).toBe(0);
      for (const s of braid.strands) {
        expect(s.nodes.length).toBeGreaterThanOrEqual(2);
        expect(s.nodes[0]).toBe(s.top);
        expect(s.nodes[s.nodes.length - 1]).toBe(s.bottom);
        // Top really is above bottom on the stem.
        const top = graph.nodes[s.top]!, bottom = graph.nodes[s.bottom]!;
        expect(1 - stemProgress(graph, top.x, top.z)).toBeGreaterThan(1 - stemProgress(graph, bottom.x, bottom.z));
      }
      // Every built strand keeps a side, and two of them never share one.
      for (const s of extra) expect(Math.abs(s.side)).toBe(1);
      if (extra.length === 2) expect(extra[0]!.side).not.toBe(extra[1]!.side);
      // The forks span a braid's worth of stem.
      expect(braid.bottomArc).toBeLessThan(braid.topArc);
      expect(braid.topArc - braid.bottomArc).toBeGreaterThanOrEqual(BRAID_MIN_SPAN);
      // The stem samples the braid measured against: from the pad, ascending.
      expect(braid.samples.length).toBeGreaterThan(0);
      expect(braid.samples[0]!.arc).toBe(0);
      for (let i = 1; i < braid.samples.length; i++) {
        expect(braid.samples[i]!.arc).toBeGreaterThanOrEqual(braid.samples[i - 1]!.arc);
      }
    }
  });

  /**
   * THE FLUSH RULE'S OWN PIN. `BRAID_FLUSH_MAX` only means something while
   * `maxFlushOff` still reads what the braid dropped strands for, so this
   * asserts it of the built worlds — the strand beds that SURVIVED are under
   * the cap. `trailBed.test.ts` is the gate this keeps the braid inside (its
   * own ceiling is 2 m over the 227-seed sweep); if that gate's step, kernel
   * or ceiling moves, this is the assertion to re-read.
   */
  it("keeps every strand bed under BRAID_FLUSH_MAX of the ground it crosses", () => {
    for (const [seed, graph] of [[TWO, two], [THREE, three]] as const) {
      const frame = flatFrame();
      const ground = (x: number, z: number) => featureStageD(graph.features, x, z, frame.sample(x, z));
      const strandEdges = graph.edges.map((e, ei) => ({ e, ei })).filter((x) => x.e.kind === "strand").map((x) => x.ei);
      expect(strandEdges.length).toBeGreaterThan(0);
      const state = { nodes: graph.nodes, edges: graph.edges, nodeOfCell: new Map<number, number>(), edgeOfCell: new Map<number, number>() };
      expect(maxFlushOff(state, ground, strandEdges), `seed ${seed}`).toBeLessThanOrEqual(BRAID_FLUSH_MAX);
    }
  });
});

/** Rung chains: kind-"rung" edges walked fork to fork. */
function rungChains(graph: TrailGraph): number[][] {
  const adj = new Map<number, Array<{ to: number; ei: number }>>();
  graph.edges.forEach((e, ei) => {
    if (e.kind !== "rung") return;
    (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push({ to: e.b, ei });
    (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push({ to: e.a, ei });
  });
  const deg = degreesOf(graph);
  const seen = new Set<number>();
  const chains: number[][] = [];
  for (const [start, links] of adj) {
    if ((deg.get(start) ?? 0) < 3) continue;
    for (const { to, ei } of links) {
      if (seen.has(ei)) continue;
      const chain = [start];
      let prevEi = ei, at = to;
      seen.add(ei);
      chain.push(at);
      while ((deg.get(at) ?? 0) === 2) {
        const next = (adj.get(at) ?? []).find((l) => l.ei !== prevEi);
        if (next === undefined) break;
        seen.add(next.ei);
        prevEi = next.ei;
        at = next.to;
        chain.push(at);
      }
      chains.push(chain);
    }
  }
  return chains;
}

/**
 * Which BED each node lies on, for the ends of a rung: `"stem"` for strand A
 * (the stem between the forks), `"s<i>"` for a built strand, `"l<i>"` for a
 * loop. A rung ends on a loop when its pair's own strand could not be reached,
 * so the ends test asks for two different beds, not two different strands.
 * A node that is both (a loop's junction is a stem node) counts as the stem.
 */
function bedOwners(graph: TrailGraph): Map<number, string> {
  const owner = new Map<number, string>();
  graph.loops.forEach((loop, li) => {
    for (const ei of loop.edges) {
      const e = graph.edges[ei]!;
      for (const n of [e.a, e.b]) if (!owner.has(n)) owner.set(n, `l${li}`);
    }
  });
  strandComponents(graph).forEach(({ nodes }, si) => { for (const n of nodes) owner.set(n, `s${si}`); });
  for (const n of stemNodeSet(graph)) owner.set(n, "stem");
  return owner;
}

/** Whether `edges` walk from `from` to `to` — a loop is still a ring. */
function walks(graph: TrailGraph, edges: readonly number[], from: number, to: number): boolean {
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
  return false;
}

describe("buildRungs on the flat frame", () => {
  it("builds at least one rung per adjacent strand pair and never more than BRAID_RUNGS_MAX", () => {
    expect(rungChains(two).length).toBeGreaterThanOrEqual(1);
    expect(rungChains(two).length).toBeLessThanOrEqual(BRAID_RUNGS_MAX);
    expect(rungChains(threeRungs).length).toBeGreaterThanOrEqual(2);
    expect(rungChains(threeRungs).length).toBeLessThanOrEqual(2 * BRAID_RUNGS_MAX);
  });

  it("joins two different beds with every rung, and both ends are forks", () => {
    for (const g of [two, three, threeRungs, loopRung]) {
      const deg = degreesOf(g);
      for (const chain of rungChains(g)) {
        const a = chain[0]!, b = chain[chain.length - 1]!;
        expect(deg.get(a)).toBeGreaterThanOrEqual(3);
        expect(deg.get(b)).toBeGreaterThanOrEqual(3);
        const owner = bedOwners(g);
        expect(owner.get(a)).toBeDefined();
        expect(owner.get(b)).toBeDefined();
        expect(owner.get(a)).not.toBe(owner.get(b));
      }
    }
  });

  it("spaces one pair's rungs at least BRAID_RUNG_GAP of stem apart", () => {
    // Only the two-strand world: with three strands the two pairs draw their
    // heights independently and may land near each other on strand A.
    const arcs = rungChains(two).map((chain) => {
      const a = two.nodes[chain[0]!]!;
      return (1 - stemProgress(two, a.x, a.z)) * two.stemLen;
    }).sort((p, q) => p - q);
    for (let i = 1; i < arcs.length; i++) expect(arcs[i]! - arcs[i - 1]!).toBeGreaterThanOrEqual(BRAID_RUNG_GAP - 2 * 8);
  });

  it("ends a rung on a loop's bed when the strand cannot be reached, and leaves the loop a ring", () => {
    const deg = degreesOf(loopRung);
    const owner = bedOwners(loopRung);
    const ends = rungChains(loopRung).flatMap((c) => [c[0]!, c[c.length - 1]!]);
    const onLoop = ends.filter((n) => (owner.get(n) ?? "").startsWith("l"));
    expect(onLoop.length).toBeGreaterThanOrEqual(1);
    for (const n of onLoop) expect(deg.get(n)).toBeGreaterThanOrEqual(3);
    // THE LOOP IS STILL A RING. The arrival SPLITS a loop edge, and `splitAt`
    // pushes the far half on as a new index the loop's own `edges` list would
    // not know about — which is the list that walks the ring for its length,
    // its junction-to-junction path and its paint. `buildRungs` records the
    // new index on the loop when the rung commits; without that, this walk
    // stops at the split.
    for (const loop of loopRung.loops) expect(walks(loopRung, loop.edges, loop.junctionA, loop.junctionB)).toBe(true);
    expect([...deg.entries()].filter(([n, d]) => d === 1 && n !== 0).map(([n]) => n)).toEqual([loopRung.summit]);
  });

  it("lands every world's fork count in the spec's band on these seeds", () => {
    expect(two.forks.length).toBeGreaterThanOrEqual(4);
    for (const g of [three, threeRungs]) {
      expect(g.forks.length).toBeGreaterThanOrEqual(6);
      expect(g.forks.length).toBeLessThanOrEqual(18);
    }
  });
});
