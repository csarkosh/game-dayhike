import { describe, it, expect } from "vitest";
import "../../src/sim/passes/index.js";
import { bowlFor, olympicPreTrailSample } from "../../src/sim/olympic.js";
import { elevationSampleAt, setActiveTerrainVariant, DEFAULT_TERRAIN_VARIANT } from "../../src/sim/terrain.js";
import { featureStageD } from "../../src/sim/features.js";
import { TRAIL_BED_HALF, TRAIL_SINK, TRAIL_SINK_RAMP, TRAIL_TUNABLES, trailSinkD, trailCorridorD } from "../../src/sim/trail.js";
import { SEEDS } from "./trailGateSeeds.js";

/**
 * The bench sink, on a hand-built stem and on a real one. THE BED SCAN, the
 * walk, the flush and the paint's buckets over the 227-seed sweep, is
 * `trailBedSweep.ts`, run in parts (`trailBedSweep.part<k>.test.ts`).
 */

setActiveTerrainVariant(DEFAULT_TERRAIN_VARIANT);

describe("the bench sink", () => {
  const nodes = [{ x: 0, z: 0, h: 10, u: 0 }, { x: 100, z: 0, h: 10, u: 100 }, { x: 100, z: 100, h: 10, u: 200 }];
  const profile = new Float64Array(51).fill(10);
  const edges = [
    { a: 0, b: 1, kind: "stem" as const, profile, progress0: 0, progress1: 0.5 },
    { a: 1, b: 2, kind: "stem" as const, profile, progress0: 0.5, progress1: 1 },
  ];
  const flat = { h: 10, dx: 0, dz: 0 };
  it("sinks the centreline by TRAIL_SINK and returns the input past the ramp", () => {
    expect(trailSinkD(nodes, edges, 50, 0, flat).h).toBeCloseTo(10 - TRAIL_SINK, 9);
    expect(trailSinkD(nodes, edges, 50, TRAIL_BED_HALF, flat).h).toBeCloseTo(10 - TRAIL_SINK, 9);
    expect(trailSinkD(nodes, edges, 50, TRAIL_BED_HALF + TRAIL_SINK_RAMP, flat)).toEqual(flat);
    expect(trailSinkD(nodes, edges, 50, 3, flat)).toEqual(flat);
  });
  it("sinks once at a junction, never twice", () => {
    expect(trailSinkD(nodes, edges, 100, 0, flat).h).toBeCloseTo(10 - TRAIL_SINK, 9);
    expect(trailSinkD(nodes, edges, 99.9, 0.1, flat).h).toBeGreaterThanOrEqual(10 - TRAIL_SINK - 1e-9);
  });
  it("carries an analytic gradient that matches a central difference across the ramp", () => {
    const eps = 1e-4;
    for (const z of [0.5, 0.8, 1.0, 1.2]) {
      const s = trailSinkD(nodes, edges, 50, z, flat);
      const fd = (trailSinkD(nodes, edges, 50, z + eps, flat).h - trailSinkD(nodes, edges, 50, z - eps, flat).h) / (2 * eps);
      expect(s.dz).toBeCloseTo(fd, 6);
      expect(s.dx).toBeCloseTo(0, 9);
    }
  });
  it("is the level-id contract: both constants are tunables", () => {
    expect(TRAIL_TUNABLES.TRAIL_SINK).toBe(0.06);
    expect(TRAIL_TUNABLES.TRAIL_SINK_RAMP).toBe(0.5);
    expect(TRAIL_TUNABLES.TRAIL_BED_HALF).toBe(0.75);
  });
  it("lowers the composed ground on a real stem by the sink", () => {
    const seed = SEEDS[0]!;
    const bowl = bowlFor(seed);
    const e = bowl.graph.edges[bowl.graph.stem[0]!]!;
    const a = bowl.graph.nodes[e.a]!, b = bowl.graph.nodes[e.b]!;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const withSink = elevationSampleAt(seed, mx, mz).h;
    // olympicPreTrailSample stops short of the feature stage (it must not read
    // the graph, which the features carve into); reproduce what olympicSample
    // hands trailCorridorD by adding that stage here, same as it does.
    const staged = featureStageD(bowl.features, mx, mz, olympicPreTrailSample(seed, mx, mz));
    const corridor = trailCorridorD(bowl.graph.nodes, bowl.graph.edges, mx, mz, staged).h;
    expect(corridor - withSink).toBeCloseTo(TRAIL_SINK, 6);
  });
});
