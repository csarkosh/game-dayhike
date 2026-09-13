import { describe, it, expect } from "vitest";
import "../../src/sim/montane.js";
import { PEAK_HEIGHT, MONTANE_TUNABLES } from "../../src/sim/montane.js";
import { terrainVariant } from "../../src/sim/terrain.js";
import {
  checkDerivatives,
  DERIV_SEED as SEED,
  sweepPoints,
  TOL_RATIO,
  variantOrThrow,
} from "./helpers/derivatives.js";

describe.each(["plain", "ridged", "dense"])("variant %s", (name) => {
  it("returns exact analytic derivatives across a wide sweep", () => {
    const { worst, steepest } = checkDerivatives(name);
    // Teeth: flat terrain would agree with anything.
    expect(steepest).toBeGreaterThan(0.3);
    expect(worst / steepest).toBeLessThan(TOL_RATIO);
  });

  it("is deterministic and finite over large and negative coordinates", () => {
    const v = variantOrThrow(name);
    // Read the variant's own declared peak, not montane's module constant —
    // dense's PEAK_HEIGHT (1100) differs from montane's (650).
    const peak = v.tunables.PEAK_HEIGHT!;
    for (const [x, z] of sweepPoints()) {
      const a = v.sample(SEED, x, z);
      expect(a).toEqual(v.sample(SEED, x, z));
      expect(Number.isFinite(a.h)).toBe(true);
      expect(Number.isFinite(a.dx)).toBe(true);
      expect(Number.isFinite(a.dz)).toBe(true);
      expect(a.h).toBeGreaterThanOrEqual(-1);
      expect(a.h).toBeLessThanOrEqual(peak + 1);
    }
  });

  it("differs between seeds", () => {
    const v = variantOrThrow(name);
    expect(v.sample(1, 501.3, -207.9).h).not.toBe(v.sample(2, 501.3, -207.9).h);
  });
});

describe("the variants differ from each other", () => {
  it("plain and ridged disagree over most of a sweep", () => {
    const plain = variantOrThrow("plain");
    const ridged = variantOrThrow("ridged");
    let differing = 0;
    const pts = sweepPoints();
    for (const [x, z] of pts) {
      if (Math.abs(plain.sample(SEED, x, z).h - ridged.sample(SEED, x, z).h) > 0.5) differing++;
    }
    expect(differing).toBeGreaterThan(pts.length * 0.8);
  });

  it("produces kilometre-scale relief, not the old ten metres", () => {
    // The reason step 4 exists: the old field spanned 0.38–10.51 m over 6.4 km.
    const v = variantOrThrow("plain");
    let lo = Infinity;
    let hi = -Infinity;
    for (const [x, z] of sweepPoints()) {
      const h = v.sample(SEED, x, z).h;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    expect(hi - lo).toBeGreaterThan(150);
  });
});

describe("variant montane", () => {
  it("is registered and is the default", () => {
    expect(terrainVariant("montane")).toBeDefined();
  });

  it("returns exact analytic derivatives across a wide sweep", () => {
    // THE test of the step. The weights vary spatially, so the
    // returned derivative includes ∂w/∂q — built from the guide Hessian.
    // Dropping that term takes worst/steepest to 6.2e-1 and flipping its sign
    // to 1.2e+0, against a truncation floor of 1.2e-3 and a bound of 0.01.
    const { worst, steepest } = checkDerivatives("montane");
    expect(steepest).toBeGreaterThan(0.3);
    expect(worst / steepest).toBeLessThan(TOL_RATIO);
  });

  it("is deterministic and finite over large and negative coordinates", () => {
    const v = variantOrThrow("montane");
    for (const [x, z] of sweepPoints()) {
      const a = v.sample(SEED, x, z);
      expect(a).toEqual(v.sample(SEED, x, z));
      expect(Number.isFinite(a.h)).toBe(true);
      expect(a.h).toBeGreaterThanOrEqual(-1);
      expect(a.h).toBeLessThanOrEqual(PEAK_HEIGHT + 1);
    }
  });

  it("differs from plain — the attenuation stages do something", () => {
    const montane = variantOrThrow("montane");
    const plain = variantOrThrow("plain");
    let differing = 0;
    const pts = sweepPoints();
    for (const [x, z] of pts) {
      if (Math.abs(montane.sample(SEED, x, z).h - plain.sample(SEED, x, z).h) > 0.5) differing++;
    }
    expect(differing).toBeGreaterThan(pts.length * 0.5);
  });
});

import { montaneSample, MONTANE_VARIANT_TUNABLES } from "../../src/sim/montane.js";

describe("montaneSample export", () => {
  it("is bit-identical to the registered montane variant", () => {
    const v = variantOrThrow("montane");
    for (const [x, z] of sweepPoints()) {
      const a = montaneSample(SEED, x, z);
      const b = v.sample(SEED, x, z);
      expect(a.h).toBe(b.h);
      expect(a.dx).toBe(b.dx);
      expect(a.dz).toBe(b.dz);
    }
  });

  it("exports the exact tunables record the variant registered", () => {
    expect(MONTANE_VARIANT_TUNABLES).toEqual(variantOrThrow("montane").tunables);
  });
});

import { denseSample, DENSE_TUNABLES, DENSE_VARIANT_TUNABLES } from "../../src/sim/montane.js";

describe("variant dense", () => {
  it("declares the amended config: 1792 wavelength, PEAK_HEIGHT 1100, floor 0, crisper ridge/erosion/talus, rest montane", () => {
    expect(DENSE_TUNABLES.UPLIFT_WAVELENGTH).toBe(1792);
    expect(DENSE_TUNABLES.UPLIFT_FLOOR).toBe(0);
    expect(DENSE_TUNABLES.PEAK_HEIGHT).toBe(1100);
    // A later retune: crisper mountains.
    expect(DENSE_TUNABLES.RIDGE_BLEND_LO).toBe(0.25);
    expect(DENSE_TUNABLES.EROSION_STRENGTH).toBe(8);
    expect(DENSE_TUNABLES.TALUS_STRENGTH).toBe(0.7);
    // Every other field inherits montane's value exactly.
    expect({
      ...DENSE_TUNABLES,
      UPLIFT_WAVELENGTH: 4096,
      PEAK_HEIGHT: 650,
      RIDGE_BLEND_LO: 0.35,
      EROSION_STRENGTH: 6,
      TALUS_STRENGTH: 0.85,
    }).toEqual(MONTANE_TUNABLES);
  });

  it("differs from montane over most of a sweep — the config does something", () => {
    const dense = variantOrThrow("dense");
    const montane = variantOrThrow("montane");
    let differing = 0;
    const pts = sweepPoints();
    for (const [x, z] of pts) {
      if (Math.abs(dense.sample(SEED, x, z).h - montane.sample(SEED, x, z).h) > 0.5) differing++;
    }
    expect(differing).toBeGreaterThan(pts.length * 0.8);
  });
});

describe("denseSample export", () => {
  it("is bit-identical to the registered dense variant", () => {
    const v = variantOrThrow("dense");
    for (const [x, z] of sweepPoints()) {
      const a = denseSample(SEED, x, z);
      const b = v.sample(SEED, x, z);
      expect(a.h).toBe(b.h);
      expect(a.dx).toBe(b.dx);
      expect(a.dz).toBe(b.dz);
    }
  });

  it("exports the exact tunables record the variant registered", () => {
    expect(DENSE_VARIANT_TUNABLES).toEqual(variantOrThrow("dense").tunables);
  });
});
