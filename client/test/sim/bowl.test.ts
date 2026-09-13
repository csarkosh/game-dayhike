import { describe, it, expect } from "vitest";
import {
  padD, inBowl, BOWL_TUNABLES,
  TRAILHEAD_U, TRAILHEAD_RADIUS, TRAILHEAD_FADE, TRAIL_Z_ANCHOR, BOWL_U_MIN, BOWL_U_MAX, BOWL_Z_HALF,
  apronWindowD, apronCliffFreeD, apronKeepD,
  APRON_Z_HALF, APRON_Z_FADE, APRON_CLIFF_U, APRON_CLIFF_FADE,
} from "../../src/sim/bowl.js";
import { ROAD_CORRIDOR_HALF } from "../../src/sim/road.js";
import type { TerrainSample } from "../../src/sim/terrain.js";

/** A synthetic base: an inland ramp with a z tilt, exact derivatives. The
 * road frame is skewed (uDz = 0.1) so the chain rule back to world z is exercised. */
const U_DZ = 0.1;
function base(u: number, z: number): TerrainSample {
  // h(u, z) = 20 + 0.3u + 0.05z; world dz = explicit ∂z + ∂u·uDz.
  return { h: 20 + 0.3 * u + 0.05 * z, dx: 0.3, dz: 0.05 + 0.3 * U_DZ };
}
const PAD_H = 31;
const sample = (u: number, z: number) => padD(u, U_DZ, z, PAD_H, base(u, z));
const R = TRAILHEAD_RADIUS + TRAILHEAD_FADE;

describe("padD", () => {
  it("returns the base AS THE SAME OBJECT outside the disc and its fade", () => {
    const b1 = base(TRAILHEAD_U + R + 0.01, TRAIL_Z_ANCHOR);
    expect(padD(TRAILHEAD_U + R + 0.01, U_DZ, TRAIL_Z_ANCHOR, PAD_H, b1)).toBe(b1);
    const b2 = base(TRAILHEAD_U, TRAIL_Z_ANCHOR + R + 0.01);
    expect(padD(TRAILHEAD_U, U_DZ, TRAIL_Z_ANCHOR + R + 0.01, PAD_H, b2)).toBe(b2);
    const b3 = base(TRAILHEAD_U - R - 0.01, TRAIL_Z_ANCHOR);
    expect(padD(TRAILHEAD_U - R - 0.01, U_DZ, TRAIL_Z_ANCHOR, PAD_H, b3)).toBe(b3);
  });

  it("holds the pad flat at padH inside the radius, zero gradient", () => {
    const cases: Array<[number, number]> = [[0, 0], [TRAILHEAD_RADIUS - 0.01, 0], [0, -(TRAILHEAD_RADIUS - 0.01)], [5, 5]];
    for (const [du, dz] of cases) {
      const s = sample(TRAILHEAD_U + du, TRAIL_Z_ANCHOR + dz);
      expect(s.h).toBe(PAD_H);
      // Math.abs: a −0 from the product rule is still zero (toBe is Object.is).
      expect(Math.abs(s.dx)).toBe(0);
      expect(Math.abs(s.dz)).toBe(0);
    }
  });

  it("returns exact analytic derivatives densely across the disc and its fade", () => {
    const H = 0.02;
    let worst = 0;
    let steepest = 0;
    let checked = 0;
    for (let z = TRAIL_Z_ANCHOR - R - 2; z <= TRAIL_Z_ANCHOR + R + 2; z += 0.37) {
      for (let u = TRAILHEAD_U - R - 2; u <= TRAILHEAD_U + R + 2; u += 0.31) {
        const s = sample(u, z);
        // Central differences in the ROAD frame at fixed uDz: ∂h/∂u and the
        // explicit ∂h/∂z; the stage's dz is explicit ∂z + ∂u·uDz.
        const ndu = (sample(u + H, z).h - sample(u - H, z).h) / (2 * H);
        const ndzExplicit = (sample(u, z + H).h - sample(u, z - H).h) / (2 * H);
        worst = Math.max(worst, Math.abs(s.dx - ndu), Math.abs(s.dz - (ndzExplicit + ndu * U_DZ)));
        steepest = Math.max(steepest, Math.abs(ndu), Math.abs(ndzExplicit));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(worst).toBeLessThan(0.01 * steepest);
  });
});

describe("inBowl and tunables", () => {
  it("bounds the bowl in the road frame", () => {
    expect(inBowl(BOWL_U_MIN + 1, 0)).toBe(true);
    expect(inBowl(BOWL_U_MIN - 1, 0)).toBe(false);
    expect(inBowl(BOWL_U_MAX + 1, 0)).toBe(false);
    expect(inBowl(500, BOWL_Z_HALF + 1)).toBe(false);
  });
  it("declares every constant, and no wall", () => {
    const keys = [
      "TRAIL_Z_ANCHOR", "BOWL_U_MIN", "BOWL_U_MAX", "BOWL_Z_HALF",
      "TRAILHEAD_U", "TRAILHEAD_RADIUS", "TRAILHEAD_FADE",
      "APRON_Z_HALF", "APRON_Z_FADE", "APRON_BLEND_END", "APRON_CLIFF_U", "APRON_CLIFF_FADE",
    ];
    for (const k of keys) expect(BOWL_TUNABLES[k], k).toBeTypeOf("number");
    expect(Object.keys(BOWL_TUNABLES).sort()).toEqual([...keys].sort());
    expect(Object.keys(BOWL_TUNABLES).some((k) => k.startsWith("WALL_"))).toBe(false);
  });

  it("puts the pad a car's worth from the road", () => {
    // 44 → 9, a car's worth from the road; BOWL_U_MIN 30 → 8, the pavement's
    // own shoulder.
    expect(TRAILHEAD_U).toBe(9);
    expect(BOWL_U_MIN).toBe(8);
    // The pad and its whole fade ring sit inside the road corridor, so its
    // height is the road's own grade rather than the pre-road terrain's.
    expect(TRAILHEAD_U + TRAILHEAD_RADIUS + TRAILHEAD_FADE).toBeLessThan(ROAD_CORRIDOR_HALF);
  });
});

describe("the apron window", () => {
  it("is 1 inside the z-window, 0 beyond it, and monotone across the fade", () => {
    expect(apronWindowD(TRAIL_Z_ANCHOR).v).toBe(1);
    expect(apronWindowD(TRAIL_Z_ANCHOR + APRON_Z_HALF - APRON_Z_FADE).v).toBe(1);
    expect(apronWindowD(TRAIL_Z_ANCHOR + APRON_Z_HALF).v).toBe(0);
    expect(apronWindowD(TRAIL_Z_ANCHOR - APRON_Z_HALF - 50).v).toBe(0);
    let prev = 1;
    for (let z = APRON_Z_HALF - APRON_Z_FADE; z <= APRON_Z_HALF; z += 1) {
      const v = apronWindowD(TRAIL_Z_ANCHOR + z).v;
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
  });
  it("returns exact z-derivatives on both sides of the anchor, with none at the anchor", () => {
    const H = 0.01;
    for (const z of [0, 5, -5, 620, -620, 655, -655, 690, -690, 699.5, -699.5, 750]) {
      const s = apronWindowD(TRAIL_Z_ANCHOR + z);
      const n = (apronWindowD(TRAIL_Z_ANCHOR + z + H).v - apronWindowD(TRAIL_Z_ANCHOR + z - H).v) / (2 * H);
      expect(Math.abs(s.dz - n), `z=${z}`).toBeLessThan(1e-4);
    }
    expect(Math.abs(apronWindowD(TRAIL_Z_ANCHOR).dz)).toBe(0);
  });
  it("frees the cliffs near the road inside the window and nowhere else", () => {
    expect(apronCliffFreeD(100, TRAIL_Z_ANCHOR).v).toBe(1);
    expect(apronCliffFreeD(APRON_CLIFF_U + APRON_CLIFF_FADE, TRAIL_Z_ANCHOR).v).toBe(0);
    expect(apronCliffFreeD(100, TRAIL_Z_ANCHOR + APRON_Z_HALF + 1).v).toBe(0);
    const mid = apronCliffFreeD(APRON_CLIFF_U + APRON_CLIFF_FADE / 2, TRAIL_Z_ANCHOR).v;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
  it("apronKeepD carries the product and chain rules into world partials", () => {
    const U_DZ = 0.1, H = 0.01;
    for (const [u, z] of [[470, 0], [490, 650], [430, -690], [300, 0], [505, 620]] as const) {
      const k = apronKeepD(u, U_DZ, z);
      // Road-frame central differences; world dz = explicit dz + du·uDz.
      const ndu = (apronKeepD(u + H, U_DZ, z).v - apronKeepD(u - H, U_DZ, z).v) / (2 * H);
      const ndz = (apronKeepD(u, U_DZ, z + H).v - apronKeepD(u, U_DZ, z - H).v) / (2 * H);
      expect(Math.abs(k.dx - ndu), `u=${u} z=${z} dx`).toBeLessThan(1e-4);
      expect(Math.abs(k.dz - (ndz + ndu * U_DZ)), `u=${u} z=${z} dz`).toBeLessThan(1e-4);
      expect(k.v).toBeCloseTo(1 - apronCliffFreeD(u, z).v, 12);
    }
  });
});
