import { afterEach, describe, expect, it, vi } from "vitest";
import { timeLimit } from "../helpers/timeLimit.js";

// The ground is sampled through the field kernel (sim/fieldKernel.ts) where the platform has WebAssembly and by
// the TypeScript where it has not, and two peers may be one of each. Here the sim is loaded twice, once each
// way, and what the builders make of the ground is compared bit for bit: samples, a collision chunk, a clipmap
// ring, a face patch. Typed arrays are compared by their bytes and numbers by `Object.is`, so a -0 for a 0 or one
// float rounded the other way fails.

type Loaded = {
  /** Montane samples the kernel made in this load. */
  kernelSamples: () => number;
  terrain: typeof import("../../src/sim/terrain.js");
  chunk: typeof import("../../src/sim/chunk.js");
  spawn: typeof import("../../src/sim/spawn.js");
  clipmap: typeof import("../../src/game/clipmap.js");
  patches: typeof import("../../src/game/facePatches.js");
};

/** The sim and the builders, loaded anew with the kernel there (`kernel`) or reported as not to be had. */
async function load(kernel: boolean): Promise<Loaded> {
  vi.resetModules();
  let samples = 0;
  vi.doMock("../../src/sim/fieldKernel.js", async () => {
    const actual = await vi.importActual<typeof import("../../src/sim/fieldKernel.js")>("../../src/sim/fieldKernel.js");
    if (!kernel) {
      return {
        ...actual,
        fieldKernelReady: (): boolean => false,
        kernelMontane: (): never => { throw new Error("the kernel was asked for where there is none"); },
      };
    }
    return {
      ...actual,
      kernelMontane: (...args: Parameters<typeof actual.kernelMontane>): ReturnType<typeof actual.kernelMontane> => {
        samples++;
        return actual.kernelMontane(...args);
      },
    };
  });
  await import("../../src/sim/passes/index.js");
  return {
    kernelSamples: () => samples,
    terrain: await import("../../src/sim/terrain.js"),
    chunk: await import("../../src/sim/chunk.js"),
    spawn: await import("../../src/sim/spawn.js"),
    clipmap: await import("../../src/game/clipmap.js"),
    patches: await import("../../src/game/facePatches.js"),
  };
}

afterEach(() => {
  vi.doUnmock("../../src/sim/fieldKernel.js");
  vi.resetModules();
});

/** Where two values differ, by path: typed arrays by their bytes, numbers by `Object.is`. */
function differences(a: unknown, b: unknown, path: string, out: string[]): string[] {
  if (out.length >= 8) return out;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.constructor !== b.constructor || a.byteLength !== b.byteLength) {
      out.push(`${path}: not the same kind or length of array`);
      return out;
    }
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) { out.push(`${path}: byte ${i}`); break; }
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}: ${a.length} against ${b.length} entries`);
    else a.forEach((v, i) => differences(v, b[i], `${path}[${i}]`, out));
    return out;
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const key of keys) differences((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`, out);
    return out;
  }
  if (!Object.is(a, b)) out.push(`${path}: ${String(a)} against ${String(b)}`);
  return out;
}

/** What the builders make of the ground of `variant` at `seed`: everything a comparison reads. */
function built(w: Loaded, variant: string, seed: number): Record<string, unknown> {
  w.terrain.setActiveTerrainVariant(variant);
  // Round the hike's start where the terrain has one, else round a far, steep place of the field.
  const start = w.spawn.trailheadStart(seed);
  const cx = start ? start.x : 3210.5, cz = start ? start.z : -1875.25;
  const samples: number[] = [];
  let steepest = 0;
  for (let k = 0; k < 600; k++) {
    // A spiral out to two kilometres, off the lattice, and every seventh place on whole metres.
    const r = 3.3 * k, x = cx + r * ((k * 37) % 17 - 8) / 8, z = cz + r * ((k * 53) % 19 - 9) / 9;
    const s = w.terrain.elevationSampleAt(seed, k % 7 === 0 ? Math.floor(x) : x, k % 7 === 0 ? Math.floor(z) : z);
    samples.push(s.h, s.dx, s.dz);
    steepest = Math.max(steepest, Math.abs(s.dx), Math.abs(s.dz));
  }
  const chunkX = Math.floor(cx / 16), chunkZ = Math.floor(cz / 16);
  const chunks = [[0, 0], [1, 0], [-2, 3]].map(([i, j]) => w.chunk.generateChunk(seed, chunkX + (i as number), chunkZ + (j as number)));
  const rings = [0, 3].map((level) => w.clipmap.createRingSamples(seed, level, cx, cz));
  // The first three cells about the place that have a face patch at all (steep or rocky ground).
  const patches: unknown[] = [];
  const cell = w.patches.facePatchCells(cx, cz, w.patches.PATCH_REACH.medium);
  for (const c of cell) {
    if (patches.length >= 3) break;
    const patch = w.patches.facePatchGeometry(seed, c.ci, c.cj, c.spacing, w.patches.NO_STITCH);
    if (patch !== null) patches.push({ at: [c.ci, c.cj, c.spacing], patch });
  }
  return { samples: Float64Array.from(samples), steepest, chunks, rings, patches, patchCount: patches.length };
}

describe("the ground by the field kernel and by the TypeScript", () => {
  it.each([["dense", 0xbe4c4], ["olympic", 0xbe4c4], ["montane", -77123456]] as const)(
    "terrain %s: samples, chunks, rings and face patches are the same to the bit",
    async (variant, seed) => {
      const withKernel = await load(true);
      const a = built(withKernel, variant, seed);
      // The kernel made this load's ground: the comparison is not of the TypeScript with itself.
      expect(withKernel.kernelSamples()).toBeGreaterThan(10_000);
      const without = await load(false);
      const b = built(without, variant, seed);
      expect(without.kernelSamples()).toBe(0);
      expect(differences(a, b, variant, [])).toEqual([]);
      // Teeth: flat ground would agree with anything, and a place with no patch compares nothing.
      expect(a.steepest as number).toBeGreaterThan(0.2);
      expect((a.rings as unknown[]).length).toBe(2);
      // The montane field has no face to patch about this place; the other two have, and three are compared.
      expect(a.patchCount).toBe(variant === "montane" ? 0 : 3);
    },
    timeLimit(120_000),
  );
});
