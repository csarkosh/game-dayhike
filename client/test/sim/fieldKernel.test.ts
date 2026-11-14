import { describe, it, expect } from "vitest";
import { fbm2, fbm2d, gradientNoise2, hash2, hash3, valueNoise2 } from "../../src/sim/field.js";
import "../../src/sim/montane.js";
import { DENSE_VARIANT_TUNABLES, MONTANE_VARIANT_TUNABLES, denseSample, montaneReference, montaneSample } from "../../src/sim/montane.js";
import { terrainVariant, type TerrainSample } from "../../src/sim/terrain.js";
import {
  MONTANE_KERNEL_FIELDS,
  fieldKernelReady,
  kernelFbm2,
  kernelFbm2d,
  kernelGradientNoise2,
  kernelGridCapacity,
  kernelHash2,
  kernelHash3,
  kernelMontane,
  kernelMontaneConfig,
  kernelMontaneGrid,
  kernelMontaneInto,
  kernelValueNoise2,
} from "../../src/sim/fieldKernel.js";

// The kernel is held to the TypeScript bit for bit: `Object.is` on every double, so a -0 for a 0 or a different
// NaN would fail as a different number does. The game's variants sample through the kernel, so the TypeScript
// side of every montane comparison is `montaneReference`: the pipeline as montane.ts writes it, never a variant's
// own `sample`, which would hold the kernel to itself.

/** The pipeline in TypeScript for a config's tunables record. */
function reference(tunables: Readonly<Record<string, number>>): (seed: number, x: number, z: number) => TerrainSample {
  const made = montaneReference(tunables);
  if (made === undefined) throw new Error("no TypeScript pipeline for this record");
  return made;
}

/** A fixed stream of numbers in [0, 1). */
function stream(start: number): () => number {
  let r = start >>> 0;
  return () => {
    r ^= r << 13;
    r ^= r >>> 17;
    r ^= r << 5;
    return (r >>> 0) / 4294967296;
  };
}

/** Places a sample is asked for: near the origin, far from it, on whole metres and on lattice lines, negative. */
function places(count: number, start: number): [number, number][] {
  const rnd = stream(start);
  const out: [number, number][] = [[0, 0], [-0, 0], [1, 1], [-1, -1], [0.5, -0.5], [4096, -4096], [1e6, -1e6], [123456.789, -98765.4321]];
  for (let k = 0; k < count; k++) {
    const span = k % 3 === 0 ? 200 : k % 3 === 1 ? 20000 : 2e6;
    const x = (rnd() - 0.5) * span, z = (rnd() - 0.5) * span;
    out.push(k % 7 === 0 ? [Math.floor(x), Math.floor(z)] : [x, z]);
  }
  return out;
}

const SEEDS = [0, 1, -1, 0xbe4c4, -77123456, 0x7fffffff, -0x80000000, 4294967296 + 17, 1.5];

function same(a: number, b: number): boolean {
  return Object.is(a, b);
}

describe("the field kernel against field.ts", () => {
  it("hash2 and hash3 return the same doubles", () => {
    let differ = 0;
    for (const seed of SEEDS) for (const [x, z] of places(2000, 0x1234)) {
      const xi = Math.floor(x), zi = Math.floor(z);
      if (!same(kernelHash2(xi, zi, seed), hash2(xi, zi, seed))) differ++;
      if (!same(kernelHash2(x, z, seed), hash2(x, z, seed))) differ++;
      if (!same(kernelHash3(xi, zi, (xi * 7) | 0, seed), hash3(xi, zi, (xi * 7) | 0, seed))) differ++;
    }
    expect(differ).toBe(0);
  });

  it("valueNoise2 and fbm2 return the same doubles", () => {
    let differ = 0;
    for (const seed of SEEDS) for (const [x, z] of places(1500, 0x2345)) {
      if (!same(kernelValueNoise2(x / 37, z / 37, seed), valueNoise2(x / 37, z / 37, seed))) differ++;
      for (const octaves of [1, 3, 6]) if (!same(kernelFbm2(x / 211, z / 211, seed, octaves), fbm2(x / 211, z / 211, seed, octaves))) differ++;
    }
    expect(differ).toBe(0);
  });

  it("gradientNoise2 and fbm2d return the same value and derivatives", () => {
    let differ = 0;
    const fields = ["v", "dx", "dz", "dxx", "dxz", "dzz"] as const;
    for (const seed of SEEDS) for (const [x, z] of places(1500, 0x3456)) {
      const a = kernelGradientNoise2(x / 53, z / 53, seed), b = gradientNoise2(x / 53, z / 53, seed);
      for (const f of fields) if (!same(a[f], b[f])) differ++;
      for (const octaves of [1, 2, 3, 8]) {
        const c = kernelFbm2d(x / 977, z / 977, seed, octaves), d = fbm2d(x / 977, z / 977, seed, octaves);
        for (const f of fields) if (!same(c[f], d[f])) differ++;
      }
    }
    expect(differ).toBe(0);
  });
});

describe("the field kernel against montane.ts", () => {
  it("takes a config from the variant's own record: every name it reads is in it", () => {
    for (const name of MONTANE_KERNEL_FIELDS) {
      expect(MONTANE_VARIANT_TUNABLES[name], name).toBeTypeOf("number");
      expect(DENSE_VARIANT_TUNABLES[name], name).toBeTypeOf("number");
    }
    // And nothing of the record is left unread: a tunable added to the pipeline has to reach the kernel.
    expect(Object.keys(MONTANE_VARIANT_TUNABLES).sort()).toEqual([...MONTANE_KERNEL_FIELDS].sort());
  });

  it("returns the same config's handle again, and refuses a record that is short a name", () => {
    expect(kernelMontaneConfig(DENSE_VARIANT_TUNABLES)).toBe(kernelMontaneConfig(DENSE_VARIANT_TUNABLES));
    const short: Record<string, number> = { ...MONTANE_VARIANT_TUNABLES };
    delete short.PEAK_HEIGHT;
    expect(() => kernelMontaneConfig(short)).toThrow(/PEAK_HEIGHT/);
  });

  it.each(["montane", "plain", "ridged", "dense"])("variant %s: the same height and gradient at every place", (name) => {
    const variant = terrainVariant(name);
    if (variant === undefined) throw new Error(`no terrain variant ${name}`);
    const handle = kernelMontaneConfig(variant.tunables), typescript = reference(variant.tunables);
    let differ = 0, steepest = 0;
    for (const seed of SEEDS) for (const [x, z] of places(1200, 0x4567)) {
      const a = kernelMontane(handle, seed, x, z), b = typescript(seed, x, z);
      if (!same(a.h, b.h) || !same(a.dx, b.dx) || !same(a.dz, b.dz)) differ++;
      // And what the variant itself hands the game, by whichever of the two it runs.
      const c = variant.sample(seed, x, z);
      if (!same(c.h, b.h) || !same(c.dx, b.dx) || !same(c.dz, b.dz)) differ++;
      steepest = Math.max(steepest, Math.abs(b.dx), Math.abs(b.dz));
    }
    expect(differ).toBe(0);
    // Teeth: flat ground would agree with anything.
    expect(steepest).toBeGreaterThan(0.3);
  });

  it("is there under Node, and a record that is no config's has no TypeScript pipeline", () => {
    expect(fieldKernelReady()).toBe(true);
    expect(montaneReference({ ...DENSE_VARIANT_TUNABLES })).toBeUndefined();
  });

  it("agrees with the plain functions the level composes with", () => {
    const montane = kernelMontaneConfig(MONTANE_VARIANT_TUNABLES), dense = kernelMontaneConfig(DENSE_VARIANT_TUNABLES);
    const montaneTs = reference(MONTANE_VARIANT_TUNABLES), denseTs = reference(DENSE_VARIANT_TUNABLES);
    let differ = 0;
    const into = new Float64Array(5);
    for (const [x, z] of places(3000, 0x5678)) {
      const a = montaneTs(0xbe4c4, x, z), b = denseTs(0xbe4c4, x, z);
      // The functions the level composes with return the TypeScript's doubles, by whichever of the two they run.
      const ra = montaneSample(0xbe4c4, x, z), rb = denseSample(0xbe4c4, x, z);
      if (!same(ra.h, a.h) || !same(ra.dx, a.dx) || !same(ra.dz, a.dz) || !same(rb.h, b.h) || !same(rb.dx, b.dx) || !same(rb.dz, b.dz)) differ++;
      const ka = kernelMontane(montane, 0xbe4c4, x, z);
      if (!same(ka.h, a.h) || !same(ka.dx, a.dx) || !same(ka.dz, a.dz)) differ++;
      kernelMontaneInto(dense, 0xbe4c4, x, z, into, 1);
      if (!same(into[1] as number, b.h) || !same(into[2] as number, b.dx) || !same(into[3] as number, b.dz)) differ++;
    }
    expect(differ).toBe(0);
    expect(into[0]).toBe(0);
    expect(into[4]).toBe(0);
  });

  it("makes a grid's samples as one call a sample does, row by row along z", () => {
    const dense = kernelMontaneConfig(DENSE_VARIANT_TUNABLES), denseTs = reference(DENSE_VARIANT_TUNABLES);
    const nx = 33, nz = 17, ox = -5123.25, oz = 880.5, step = 0.5;
    const grid = Float64Array.from(kernelMontaneGrid(dense, 7, ox, oz, step, nx, nz));
    expect(grid.length).toBe(nx * nz * 3);
    let differ = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const s = denseTs(7, ox + i * step, oz + j * step), at = 3 * (j * nx + i);
      if (!same(grid[at] as number, s.h) || !same(grid[at + 1] as number, s.dx) || !same(grid[at + 2] as number, s.dz)) differ++;
    }
    expect(differ).toBe(0);
  });

  it("refuses a grid larger than it holds, and one of no samples", () => {
    const dense = kernelMontaneConfig(DENSE_VARIANT_TUNABLES);
    const side = Math.floor(Math.sqrt(kernelGridCapacity()));
    expect(kernelMontaneGrid(dense, 1, 0, 0, 1, side, side).length).toBe(side * side * 3);
    expect(() => kernelMontaneGrid(dense, 1, 0, 0, 1, side + 1, side)).toThrow(/does not fit/);
    expect(() => kernelMontaneGrid(dense, 1, 0, 0, 1, 0, 4)).toThrow(/does not fit/);
  });
});
