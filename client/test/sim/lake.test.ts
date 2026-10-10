import { describe, expect, it } from "vitest";
import "../../src/sim/olympic.js";
import { bowlFor } from "../../src/sim/olympic.js";
import { featureStageD, marshWeightAt, lobePoints, MARSH_AMP, MARSH_MURK_MIN } from "../../src/sim/features.js";
import { lakeShoreInto, newLakeShore, rayToShore } from "../../src/sim/lakeShape.js";
import { checkDerivatives, TOL_RATIO, variantOrThrow } from "./helpers/derivatives.js";
import { firstPondWorld } from "./helpers/lakes.js";
import { activeTerrainVariant, type LakeSource } from "../../src/sim/terrain.js";
import { LOBBY_SEEDS } from "./trailGateSeeds.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe("the lake in the composed field", { timeout: timeLimit(120_000) }, () => {
  it("gives every pond a valley lake's shape at its own level, centre and murk", () => {
    for (const seed of LOBBY_SEEDS.slice(0, 30)) {
      for (const f of bowlFor(seed).features) {
        if (f.kind === "pond") {
          const shape = f.shape!;
          expect(shape.family, `seed ${seed}`).toBe("valley");
          expect(shape.level, `seed ${seed}`).toBe(f.height);
          expect(shape.murk, `seed ${seed}`).toBe(f.murk);
          expect([f.x, f.z], `seed ${seed}`).toEqual([shape.cx, shape.cz]);
          expect(f.murk, `seed ${seed}`).toBeGreaterThanOrEqual(0);
          expect(f.murk, `seed ${seed}`).toBeLessThanOrEqual(1);
          expect(shape.bound, `seed ${seed}`).toBeGreaterThan(shape.shoreMax);
        } else {
          expect(f.murk).toBeUndefined();
          expect(f.shape).toBeUndefined();
        }
      }
    }
  });

  it("carves the lake's bed into the ground, in the build's field as in the composed one", () => {
    const { seed, pond } = firstPondWorld();
    const shape = pond.shape!;
    const v = variantOrThrow("olympic");
    const r = newLakeShore();
    // The centre, and a point 5 m in from the shore on the side away from any marsh.
    const ax = pond.lobe ? -pond.lobe.dirX : 1, az = pond.lobe ? -pond.lobe.dirZ : 0;
    const d = rayToShore(shape, shape.cx, shape.cz, ax, az, 5, shape.bound);
    for (const [x, z] of [[shape.cx, shape.cz], [shape.cx + ax * d, shape.cz + az * d]] as const) {
      const want = shape.level - lakeShoreInto(r, shape, x, z).depth;
      expect(want).toBeLessThan(shape.level);
      expect(v.sample(seed, x, z).h).toBeCloseTo(want, 6);
      expect(featureStageD(bowlFor(seed).features, x, z, { h: -1000, dx: 0, dz: 0 }).h).toBeCloseTo(want, 9);
    }
  });

  it("has exact derivatives across the bed, the shore, the bank and the apron", () => {
    const { seed, pond } = firstPondWorld();
    const shape = pond.shape!;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI + 0.37;
      for (const k of [0.1, 0.3, 0.5, 0.62, 0.7, 0.8, 0.9, 0.97, 1.03, 1.2, 1.4]) {
        pts.push([shape.cx + Math.cos(a) * k * shape.shoreMax, shape.cz + Math.sin(a) * k * shape.shoreMax]);
      }
    }
    const { worst, steepest } = checkDerivatives("olympic", pts, seed);
    expect(worst / steepest).toBeLessThan(TOL_RATIO);
  });
});

describe("the water bodies", { timeout: timeLimit(120_000) }, () => {
  it("are the sea, then one lake per pond, at the pond's level, centre, murk, shape and bound", () => {
    const { seed, pond } = firstPondWorld();
    const bodies = variantOrThrow("olympic").waterBodies!(seed);
    expect(bodies[0]).toEqual({ kind: "sea", level: 0 });
    const lakes = bodies.filter((b): b is LakeSource => b.kind === "lake");
    expect(lakes).toHaveLength(1);
    expect(lakes[0]).toMatchObject({ level: pond.height, x: pond.x, z: pond.z, radius: pond.radius, murk: pond.murk, bound: pond.shape!.bound });
    expect(lakes[0]!.shape).toBe(pond.shape);
    expect(variantOrThrow("olympic").waterBodies!(seed)).toBe(bodies); // cached
  });

  it("are the sea alone in a world with no pond", () => {
    const seed = LOBBY_SEEDS.find((s) => !bowlFor(s).features.some((f) => f.kind === "pond"))!;
    expect(activeTerrainVariant().waterBodies!(seed)).toEqual([{ kind: "sea", level: 0 }]);
  });
});

describe("the marsh in the composed field", { timeout: timeLimit(120_000) }, () => {
  it("is held at the lake's level in a real world, and has exact derivatives", () => {
    const { seed, pond } = firstPondWorld((f) => (f.murk ?? 0) > 0.7);
    expect(pond.lobe).not.toBeNull();
    const v = variantOrThrow("olympic");
    const pts = lobePoints(pond.shape!, pond.lobe, 1);
    let core = 0;
    for (const [x, z] of pts) {
      if (marshWeightAt(pond.shape!, pond.lobe, x, z) < 1) continue;
      core++;
      expect(Math.abs(v.sample(seed, x, z).h - pond.height)).toBeLessThanOrEqual(MARSH_AMP + 1e-9);
    }
    expect(core).toBeGreaterThan(10);
    const { worst, steepest } = checkDerivatives("olympic", pts.filter((_, i) => i % 3 === 0), seed);
    expect(worst / steepest).toBeLessThan(TOL_RATIO);
  });

  it("is on a pond exactly when its murk is above 0.5", () => {
    for (const seed of LOBBY_SEEDS.slice(0, 40)) {
      for (const f of bowlFor(seed).features) {
        if (f.kind !== "pond") continue;
        expect(f.lobe === null, `seed ${seed}`).toBe(!((f.murk ?? 0) > MARSH_MURK_MIN));
      }
    }
  });
});
