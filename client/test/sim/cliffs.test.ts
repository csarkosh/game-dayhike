import { describe, expect, it } from "vitest";
import {
  CLIFF_ALT_HI, CLIFF_BENCH, CLIFF_OUT_ALT_HI, CLIFF_OUT_ALT_LO, CLIFF_PERIOD,
  cliffD, cliffMaskD,
  terraceDeltaD, terraceStepD,
} from "../../src/sim/cliffs.js";
import { olympicBaseSample } from "../../src/sim/olympic.js";
import type { TerrainSample } from "../../src/sim/terrain.js";
import { variantOrThrow } from "./helpers/derivatives.js";
import { centerlineX } from "./helpers/roadLine.js";

describe("terrace step", () => {
  it("spans exactly one band: step(0) = 0, step(1) = 1", () => {
    expect(terraceStepD(0).v).toBe(0);
    expect(terraceStepD(1).v).toBe(1);
  });

  it("is monotone with the bench floor: step′ ≥ 1 − CLIFF_BENCH everywhere", () => {
    for (let i = 0; i <= 1000; i++) {
      expect(terraceStepD(i / 1000).d).toBeGreaterThanOrEqual(1 - CLIFF_BENCH);
    }
  });

  it("has a real riser at the band midpoint", () => {
    // (1 − BENCH) + BENCH·(15/16)/RISER_HALF ≈ 6.45 at the starting values;
    // 5 is a floor that any working riser clears and any dropped term cannot.
    expect(terraceStepD(0.5).d).toBeGreaterThan(5);
  });

  it("matches its own derivative numerically", () => {
    const H = 1e-5;
    for (let i = 1; i < 200; i++) {
      const f = i / 200;
      const n = (terraceStepD(f + H).v - terraceStepD(f - H).v) / (2 * H);
      expect(Math.abs(terraceStepD(f).d - n)).toBeLessThan(1e-3);
    }
  });
});

describe("terrace delta", () => {
  it("is value- and derivative-continuous across the band wrap", () => {
    const E = 1e-9;
    for (const k of [-3, 0, 1, 7]) {
      const lo = terraceDeltaD(k * CLIFF_PERIOD - E);
      const hi = terraceDeltaD(k * CLIFF_PERIOD + E);
      expect(Math.abs(lo.v - hi.v)).toBeLessThan(1e-6);
      expect(Math.abs(lo.d - hi.d)).toBeLessThan(1e-6);
    }
  });

  it("never exceeds the derived bound PERIOD·BENCH/2", () => {
    const bound = (CLIFF_PERIOD * CLIFF_BENCH) / 2;
    for (let i = -2000; i <= 2000; i++) {
      expect(Math.abs(terraceDeltaD(i * 0.317).v)).toBeLessThanOrEqual(bound + 1e-9);
    }
  });

  it("is periodic: Δ(g + PERIOD) = Δ(g)", () => {
    for (let i = 0; i < 100; i++) {
      const g = i * 1.373 - 60;
      expect(terraceDeltaD(g + CLIFF_PERIOD).v).toBeCloseTo(terraceDeltaD(g).v, 9);
    }
  });

  it("matches its own derivative numerically, riser included", () => {
    const H = 1e-5;
    for (let i = 0; i < 300; i++) {
      const g = 100 + i * 0.31; // ~3.5 bands, dense enough to cross risers
      const n = (terraceDeltaD(g + H).v - terraceDeltaD(g - H).v) / (2 * H);
      expect(Math.abs(terraceDeltaD(g).d - n)).toBeLessThan(1e-3);
    }
  });
});

const SEED = 0x5eed;
const flatAt = (h: number): TerrainSample => ({ h, dx: 0.01, dz: -0.02 });

describe("cliff mask", () => {
  it("is exactly zero below the outcrop altitude floor, whatever the noise", () => {
    for (let i = 0; i < 50; i++) {
      const m = cliffMaskD(SEED, i * 1237.1, i * -911.7, 500, 0, flatAt(5 + (i % 7)));
      expect(m.v).toBe(0);
      expect(m.dx).toBe(0);
      expect(m.dz).toBe(0);
    }
  });

  it("is exactly zero inside the road suppression radius, whatever the altitude", () => {
    for (const u of [0, 10, 29.9, -29.9]) {
      expect(cliffMaskD(SEED, 2000, 500, u, 0.1, flatAt(180)).v).toBe(0);
    }
  });

  it("stays in [0, 1] across altitudes and offsets", () => {
    for (let i = 0; i < 400; i++) {
      const m = cliffMaskD(SEED, i * 173.3, i * -211.9, 31 + i, 0.05, flatAt(i));
      expect(m.v).toBeGreaterThanOrEqual(0);
      expect(m.v).toBeLessThanOrEqual(1);
    }
  });

  it("reaches real strength somewhere on mountain ground", () => {
    let best = 0;
    for (let i = 0; i < 400; i++) {
      best = Math.max(best, cliffMaskD(SEED, i * 137.7, i * 91.3 - 9000, 500, 0, flatAt(250)).v);
    }
    expect(best).toBeGreaterThan(0.7);
  });
});

describe("cliffD", () => {
  it("returns the base AS THE SAME OBJECT when the mask is cold", () => {
    const beach = flatAt(5);
    expect(cliffD(SEED, 3000, 3000, 500, 0, beach)).toBe(beach);
    const centerline = flatAt(200);
    expect(cliffD(SEED, 3000, 3000, 0, 0.03, centerline)).toBe(centerline);
    const nearRoad = flatAt(200);
    expect(cliffD(SEED, 3000, 3000, -25, 0.03, nearRoad)).toBe(nearRoad);
  });

  it("terraces a hot point within the derived bound", () => {
    // The mask sweep above found strength > 0.7 at h = 250; the same scan
    // must produce a visible, bounded displacement.
    let moved = 0;
    const bound = (CLIFF_PERIOD * CLIFF_BENCH) / 2 + 1e-9;
    for (let i = 0; i < 400; i++) {
      const base = flatAt(250);
      const c = cliffD(SEED, i * 137.7, i * 91.3 - 9000, 500, 0, base);
      expect(Math.abs(c.h - base.h)).toBeLessThanOrEqual(bound);
      if (c.h !== base.h) moved++;
    }
    expect(moved).toBeGreaterThan(100);
  });

  it("matches numeric derivatives through the full composition (independent oracle)", () => {
    // A synthetic C∞ base with EXACT known derivatives (test-side trig is
    // allowed). Altitude 110–230 crosses the mountain gate and several
    // bands; u = 1000 keeps road suppression saturated so uDz = 0 is exact.
    const synthBase = (x: number, z: number): TerrainSample => ({
      h: 170 + 60 * Math.sin(x / 97) * Math.cos(z / 113),
      dx: (60 / 97) * Math.cos(x / 97) * Math.cos(z / 113),
      dz: (-60 / 113) * Math.sin(x / 97) * Math.sin(z / 113),
    });
    const at = (x: number, z: number) => cliffD(SEED, x, z, 1000, 0, synthBase(x, z));
    const H = 0.02;
    let worst = 0;
    let steepest = 0;
    for (let i = 0; i < 30; i++) {
      for (let j = 0; j < 15; j++) {
        const x = 5000 + i * 37.7 + 0.318;
        const z = -700 + j * 53.3 - 0.947;
        const s = at(x, z);
        const ndx = (at(x + H, z).h - at(x - H, z).h) / (2 * H);
        const ndz = (at(x, z + H).h - at(x, z - H).h) / (2 * H);
        worst = Math.max(worst, Math.abs(s.dx - ndx), Math.abs(s.dz - ndz));
        steepest = Math.max(steepest, Math.abs(ndx), Math.abs(ndz));
      }
    }
    expect(worst).toBeLessThan(0.01 * steepest);
  });
});

describe("domain census — 90 km, both signs of z", () => {
  const v = () => variantOrThrow("olympic");
  const zs: number[] = [];
  for (let z = -45000; z <= 45000; z += 487) zs.push(z + 0.5);

  it("never terraces the beach: the shore band is bit-identical", () => {
    // x at signed coast distance +4 m: d(x) = x − coastline(z), one
    // algebraic step from any probe (the centerlineX idiom).
    const dAt = (x: number, z: number) => v().coastDistance!(SEED, x, z);
    for (const z of zs) {
      const x = 0 - dAt(0, z) + 4;
      const b = olympicBaseSample(SEED, x, z);
      expect(b.h).toBeLessThan(CLIFF_OUT_ALT_LO); // the gate is what protects it
      const a = v().sample(SEED, x, z);
      expect(a.h).toBe(b.h);
    }
  });

  it("keeps the grade lattice untouched: identity at the centerline", () => {
    for (const z of zs) {
      const x = centerlineX(z);
      const b = olympicBaseSample(SEED, x, z);
      expect(cliffD(SEED, x, z, 0, 0.03, b)).toBe(b);
    }
  });

  it("covers a real fraction of high ground — and not all of it", () => {
    let high = 0;
    let active = 0;
    let maxM = 0;
    for (const z of zs) {
      for (const xo of [1400, 2300, 3200, 4100]) {
        const x = xo + 0.318;
        const b = olympicBaseSample(SEED, x, z);
        if (b.h <= CLIFF_ALT_HI) continue;
        high++;
        // This far inland the road (x_r ∈ [−565, −45]) is > 1 km away:
        // suppression saturated, unsigned distance and uDz = 0 exact.
        const m = cliffMaskD(SEED, x, z, 2000, 0, b);
        maxM = Math.max(maxM, m.v);
        if (m.v > 0.25) active++;
      }
    }
    expect(high).toBeGreaterThan(40);            // measured: 82 post-retune (dd25447); floor at ~half — the sweep saw real mountains
    const frac = active / high;                  // measured: 0.32926829268292684 (high=82, active=27)
    expect(frac).toBeGreaterThan(0.15);          // cliffs exist at scale
    expect(frac).toBeLessThan(0.85);             // mountains keep soft flanks
    expect(maxM).toBeGreaterThan(0.7);           // full-strength faces occur
  });

  it("keeps lowland outcrops sparse — present but rare", () => {
    let low = 0;
    let out = 0;
    for (const z of zs) {
      for (const xo of [150, 420, 690]) {
        const x = xo + 0.318;
        const b = olympicBaseSample(SEED, x, z);
        if (b.h < CLIFF_OUT_ALT_HI || b.h > 100) continue;
        low++;
        // x ≥ 150 puts every point > 195 m from the road: suppression
        // saturated (see the coverage test's note).
        if (cliffMaskD(SEED, x, z, 2000, 0, b).v > 0.1) out++;
      }
    }
    expect(low).toBeGreaterThan(120);
    const frac = out / low;                      // measured: 0.08670520231213873 (low=173, out=15)
    expect(frac).toBeGreaterThan(0.01);
    expect(frac).toBeLessThan(0.35);
  });

  it("moves no point more than the derived bound, and stays finite", () => {
    const bound = (CLIFF_PERIOD * CLIFF_BENCH) / 2 + 1e-9;
    for (const z of zs) {
      for (const xo of [300, 1400, 2600, 3800]) {
        const x = xo + 0.318;
        const b = olympicBaseSample(SEED, x, z);
        const c = cliffD(SEED, x, z, 2000, 0, b);
        expect(Math.abs(c.h - b.h)).toBeLessThanOrEqual(bound);
        expect(Number.isFinite(c.dx) && Number.isFinite(c.dz)).toBe(true);
      }
    }
  });

  it("is deterministic at large and negative coordinates", () => {
    const a = cliffD(SEED, -91237.4, 88411.9, 2000, 0, olympicBaseSample(SEED, -91237.4, 88411.9));
    const b = cliffD(SEED, -91237.4, 88411.9, 2000, 0, olympicBaseSample(SEED, -91237.4, 88411.9));
    expect(a).toEqual(b);
    expect(Number.isFinite(a.h)).toBe(true);
  });
});
