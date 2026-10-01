import { describe, expect, it } from "vitest";
import "../../src/sim/olympic.js";
import { bowlFor } from "../../src/sim/olympic.js";
import { lakeDepthD, LAKE_SHELF_WIDTH } from "../../src/sim/features.js";
import { checkDerivatives, TOL_RATIO, variantOrThrow } from "./helpers/derivatives.js";
import { firstPondWorld } from "./helpers/lakes.js";
import { LOBBY_SEEDS } from "./trailGateSeeds.js";
import { timeLimit } from "../helpers/timeLimit.js";

describe("the lake in the composed field", { timeout: timeLimit(120_000) }, () => {
  it("gives every pond a murk in [0, 1]", () => {
    for (const seed of LOBBY_SEEDS.slice(0, 30)) {
      for (const f of bowlFor(seed).features) {
        if (f.kind === "pond") {
          expect(f.murk, `seed ${seed}`).toBeGreaterThanOrEqual(0);
          expect(f.murk, `seed ${seed}`).toBeLessThanOrEqual(1);
        } else {
          expect(f.murk).toBeUndefined();
        }
      }
    }
  });

  it("carves the lake's bed into the ground: the shelf, then the middle", () => {
    const { seed, pond } = firstPondWorld();
    const v = variantOrThrow("olympic");
    const shelf = v.sample(seed, pond.x + pond.radius - LAKE_SHELF_WIDTH, pond.z).h;
    expect(shelf).toBeCloseTo(pond.height - lakeDepthD(LAKE_SHELF_WIDTH, pond.murk!).v, 6);
    const middle = v.sample(seed, pond.x, pond.z).h;
    expect(middle).toBeCloseTo(pond.height - lakeDepthD(pond.radius, pond.murk!).v, 6);
  });

  it("has exact derivatives across the bed, the rim and the apron", () => {
    const { seed, pond } = firstPondWorld();
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI + 0.37;
      for (const k of [0.1, 0.3, 0.5, 0.62, 0.7, 0.8, 0.9, 0.97, 1.03, 1.2, 1.4]) {
        pts.push([pond.x + Math.cos(a) * k * pond.radius, pond.z + Math.sin(a) * k * pond.radius]);
      }
    }
    const { worst, steepest } = checkDerivatives("olympic", pts, seed);
    expect(worst / steepest).toBeLessThan(TOL_RATIO);
  });
});
