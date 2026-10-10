import { describe, expect, it } from "vitest";
import { lakeGroundD, LAKE_SILL } from "../../src/sim/features.js";
import { valleyLakeShape, type LakeShape } from "../../src/sim/lakeShape.js";
import { LOBBY_SEEDS } from "./trailGateSeeds.js";
import type { TerrainSample } from "../../src/sim/terrain.js";
import { stadiumShape } from "../helpers/lakeShapes.js";
import { H, TOL_RATIO } from "./helpers/derivatives.js";
import { timeLimit } from "../helpers/timeLimit.js";

// A stadium at level 50, murk 1, 15 m of half-width and 15 m of spine about
// the origin, its steep side toward +x, an apron of 20 m all round (read back
// through the smooth floor as 20.0156097709407 m), on flat ground at 49.
const lake = stadiumShape({ cx: 0, cz: 0, halfLen: 7.5, w: 15, size: 20, level: 50, murk: 1, apron: 20 });
const spouted: LakeShape = { ...lake, spout: { ax: -15, az: 0, bx: -23, bz: 0, half: 3 } };
const flat: TerrainSample = { h: 49, dx: 0, dz: 0 };
const A = 20.0156097709407;

function near(s: TerrainSample, h: number, dx: number, dz: number): void {
  expect(s.h).toBeCloseTo(h, 9);
  expect(s.dx).toBeCloseTo(dx, 9);
  expect(s.dz).toBeCloseTo(dz, 9);
}

describe("the lake's ground", { timeout: timeLimit(30_000) }, () => {
  it("is the bed under the water: the level less the depth", () => {
    near(lakeGroundD(lake, 0, 0, flat), 47, 0, 0);
    near(lakeGroundD(lake, 12, 0, flat), 49.55, 0.28125, 0);
  });

  it("rises from the shore at the bank's grade by the side weight, eased over the first metre", () => {
    near(lakeGroundD(lake, -15.5, 0, flat), 50.03, -0.1725, 0);
    near(lakeGroundD(lake, -17, 0, flat), 50.24, -0.12, 0);
    near(lakeGroundD(lake, 17, 0, flat), 51, 0.5, 0);
    near(lakeGroundD(lake, -19, 0, flat), 50.48, -0.12, 0);
  });

  it("tops the bank at least 0.45 m over the level all round a lake with no outlet", () => {
    // 4 m out from the shore all round: along the flanks and round the caps.
    const pts: Array<[number, number]> = [];
    for (let z = -7.5; z <= 7.5; z += 0.5) pts.push([19, z], [-19, z]);
    for (let k = 0; k <= 180; k++) {
      const a = (k * Math.PI) / 180;
      pts.push([19 * Math.cos(a), 7.5 + 19 * Math.sin(a)], [19 * Math.cos(a), -7.5 - 19 * Math.sin(a)]);
    }
    for (const [x, z] of pts) {
      expect(lakeGroundD(lake, x, z, { h: 0, dx: 0, dz: 0 }).h, `(${x}, ${z})`).toBeGreaterThanOrEqual(50.45);
    }
  });

  it("blends into the hillside over the apron, and hands the input back past it", () => {
    expect(lakeGroundD(lake, -(15 + 4 + A / 2), 0, flat).h).toBeCloseTo(50.340468293128225, 9);
    expect(lakeGroundD(lake, -(15 + 4 + A) - 0.01, 0, flat)).toBe(flat);
    expect(lakeGroundD(lake, lake.bound + 1, 0, flat)).toBe(flat);
  });

  it("notches the bank to a sill LAKE_SILL over the level beyond the spout", () => {
    expect(LAKE_SILL).toBe(0.3);
    near(lakeGroundD(spouted, -30, 0, flat), 50.3, 0, 0);
    // Away from the notch the bank stands well over the sill.
    expect(lakeGroundD(spouted, 0, -7.5 - 15 - 3.5, flat).h).toBeGreaterThan(50.8);
  });

  it("hands its input back, as the same object, at 720 directions a quarter metre inside a drawn lake's bound", () => {
    const hill = (x: number): number => 100 + 0.1 * x;
    for (const seed of LOBBY_SEEDS.slice(0, 10)) {
      const drawn = valleyLakeShape(seed, 1, 300, 50, 32, 0.1, 0, hill);
      for (let k = 0; k < 720; k++) {
        const a = (k * Math.PI) / 360, d = drawn.bound - 0.25;
        const x = drawn.cx + Math.cos(a) * d, z = drawn.cz + Math.sin(a) * d;
        const base: TerrainSample = { h: hill(x), dx: 0.1, dz: 0 };
        expect(lakeGroundD(drawn, x, z, base), `seed ${seed} direction ${k}`).toBe(base);
      }
    }
  });

  it("has exact derivatives across the bed, the bank, the notch and the apron, on a tilted hillside", () => {
    const harmA = new Array<number>(14).fill(0), harmB = new Array<number>(14).fill(0);
    harmA[0] = 0.05; harmB[1] = 0.04; harmA[4] = 0.02;
    const full: LakeShape = { ...spouted, harmA, harmB, noiseAmp: 0.02, noiseSeed: 9, apron: [14, 3, -2, 1, 0.5, 0, 0.8] };
    const base = (x: number, z: number): TerrainSample => ({ h: 49 + 0.05 * x - 0.02 * z, dx: 0.05, dz: -0.02 });
    const at = (x: number, z: number): TerrainSample => lakeGroundD(full, x, z, base(x, z));
    let worst = 0, steepest = 0;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI + 0.37;
      for (const k of [0.1, 0.3, 0.5, 0.62, 0.7, 0.8, 0.9, 0.97, 1.03, 1.2, 1.4, 1.6, 1.9, 2.2]) {
        const x = Math.cos(a) * k * 22.5, z = Math.sin(a) * k * 22.5;
        const s = at(x, z);
        const ndx = (at(x + H, z).h - at(x - H, z).h) / (2 * H);
        const ndz = (at(x, z + H).h - at(x, z - H).h) / (2 * H);
        worst = Math.max(worst, Math.abs(s.dx - ndx), Math.abs(s.dz - ndz));
        steepest = Math.max(steepest, Math.abs(ndx), Math.abs(ndz));
      }
    }
    expect(worst / steepest).toBeLessThan(TOL_RATIO);
  });
});
