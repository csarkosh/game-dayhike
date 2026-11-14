/**
 * The field kernel: `field.ts` and the montane pipeline of `montane.ts` compiled from Rust (client/rust/field)
 * to WebAssembly, returning the same doubles to the bit (fieldKernel.test.ts holds every function here to its
 * TypeScript original, which stays the reference). About twice the TypeScript's speed on a montane sample.
 *
 * The module is instantiated here, synchronously, the first time anything asks for it: its bytes are in
 * `kernel/fieldWasm.ts`, built and committed by `npm run kernel:build`, so nothing is fetched and a page, a
 * worker and a test under Node all get it the same way.
 *
 * Nothing in the kernel is a tunable of its own. A montane config is written into it once
 * (`kernelMontaneConfig`) from the record the TypeScript already makes for the variant's level id
 * (`MONTANE_VARIANT_TUNABLES`, `DENSE_VARIANT_TUNABLES`), so the numbers that enter a level id have one source.
 *
 * sim/ determinism rules apply on both sides: the kernel adds, subtracts, multiplies, divides, floors and takes
 * square roots, which WebAssembly defines to the bit on every engine, and nothing else.
 */
import { FIELD_WASM_BASE64 } from "./kernel/fieldWasm.js";
import type { NoiseSample } from "./field.js";
import type { TerrainSample } from "./terrain.js";

/** A montane config's numbers in the order the kernel reads them: the pipeline's tunables, then its flags, by
 * the names of the variant's tunables record. */
export const MONTANE_KERNEL_FIELDS = [
  "UPLIFT_WAVELENGTH", "UPLIFT_OCTAVES", "UPLIFT_POWER", "UPLIFT_FLOOR",
  "WARP_COARSE_WAVELENGTH", "WARP_COARSE_STRENGTH", "WARP_FINE_WAVELENGTH", "WARP_FINE_STRENGTH", "WARP_OCTAVES",
  "RELIEF_WAVELENGTH", "RELIEF_OCTAVES", "PEAK_HEIGHT",
  "EROSION_STRENGTH", "REPOSE_SLOPE", "TALUS_BAND", "TALUS_STRENGTH", "RIDGE_EPSILON", "RIDGE_BLEND_LO", "RIDGE_BLEND_HI",
  "WARP_ENABLED", "EROSION_ENABLED", "TALUS_ENABLED", "UPLIFT_OVERRIDE",
] as const;

type Exports = {
  memory: WebAssembly.Memory;
  out_ptr(): number;
  out_samples(): number;
  cfg_ptr(): number;
  cfg_slots(): number;
  cfg_len(): number;
  hash2(x: number, z: number, seed: number): number;
  hash3(x: number, z: number, i: number, seed: number): number;
  value_noise2(x: number, z: number, seed: number): number;
  fbm2(x: number, z: number, seed: number, octaves: number): number;
  gradient_noise2(x: number, z: number, seed: number): number;
  fbm2d(x: number, z: number, seed: number, octaves: number): number;
  montane(slot: number, seed: number, x: number, z: number): number;
  montane_grid(slot: number, seed: number, ox: number, oz: number, step: number, nx: number, nz: number): number;
};

type Kernel = { ex: Exports; out: Float64Array; cfg: Float64Array; slots: number; samples: number; configs: Map<Readonly<Record<string, number>>, number> };
let kernel: Kernel | null = null;

function load(): Kernel {
  if (kernel === null) {
    const binary = atob(FIELD_WASM_BASE64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ex = new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports as unknown as Exports;
    if (ex.cfg_len() !== MONTANE_KERNEL_FIELDS.length) throw new Error("the field kernel and fieldKernel.ts disagree on a montane config's length");
    const samples = ex.out_samples(), slots = ex.cfg_slots();
    // The kernel never grows its memory, so these views stay valid for its life.
    kernel = {
      ex, slots, samples,
      out: new Float64Array(ex.memory.buffer, ex.out_ptr(), samples * 3),
      cfg: new Float64Array(ex.memory.buffer, ex.cfg_ptr(), slots * MONTANE_KERNEL_FIELDS.length),
      configs: new Map(),
    };
  }
  return kernel;
}

/** `hash2` of field.ts. */
export function kernelHash2(x: number, z: number, seed: number): number {
  return load().ex.hash2(x, z, seed);
}

/** `hash3` of field.ts. */
export function kernelHash3(x: number, z: number, i: number, seed: number): number {
  return load().ex.hash3(x, z, i, seed);
}

/** `valueNoise2` of field.ts. */
export function kernelValueNoise2(x: number, z: number, seed: number): number {
  return load().ex.value_noise2(x, z, seed);
}

/** `fbm2` of field.ts. */
export function kernelFbm2(x: number, z: number, seed: number, octaves: number): number {
  return load().ex.fbm2(x, z, seed, octaves);
}

function noise(out: Float64Array): NoiseSample {
  return { v: out[0] as number, dx: out[1] as number, dz: out[2] as number, dxx: out[3] as number, dxz: out[4] as number, dzz: out[5] as number };
}

/** `gradientNoise2` of field.ts. */
export function kernelGradientNoise2(x: number, z: number, seed: number): NoiseSample {
  const k = load();
  k.ex.gradient_noise2(x, z, seed);
  return noise(k.out);
}

/** `fbm2d` of field.ts. */
export function kernelFbm2d(x: number, z: number, seed: number, octaves: number): NoiseSample {
  const k = load();
  k.ex.fbm2d(x, z, seed, octaves);
  return noise(k.out);
}

/**
 * Hands the kernel a montane config and returns its handle. `tunables` is a variant's record (montane.ts's
 * `variantTunables`: the pipeline's numbers and its flags by name); the same record handed again returns the same
 * handle. Throws on a missing name, and when the kernel holds as many configs as it can.
 */
export function kernelMontaneConfig(tunables: Readonly<Record<string, number>>): number {
  const k = load();
  const held = k.configs.get(tunables);
  if (held !== undefined) return held;
  const slot = k.configs.size;
  if (slot >= k.slots) throw new Error(`the field kernel holds ${k.slots} montane configs and no more`);
  MONTANE_KERNEL_FIELDS.forEach((name, i) => {
    const value = tunables[name];
    if (value === undefined) throw new Error(`a montane config for the field kernel has no ${name}`);
    k.cfg[slot * MONTANE_KERNEL_FIELDS.length + i] = value;
  });
  k.configs.set(tunables, slot);
  return slot;
}

/** One sample of the montane pipeline under the config `handle` names: montane.ts's `sampleWith`. */
export function kernelMontane(handle: number, seed: number, x: number, z: number): TerrainSample {
  const k = load();
  k.ex.montane(handle, seed, x, z);
  return { h: k.out[0] as number, dx: k.out[1] as number, dz: k.out[2] as number };
}

/** The same sample written to `into` at `at` as h, dx, dz, making no object. */
export function kernelMontaneInto(handle: number, seed: number, x: number, z: number, into: Float64Array, at: number): void {
  const k = load();
  k.ex.montane(handle, seed, x, z);
  into[at] = k.out[0] as number;
  into[at + 1] = k.out[1] as number;
  into[at + 2] = k.out[2] as number;
}

/** The most samples one `kernelMontaneGrid` call can make. */
export function kernelGridCapacity(): number {
  return load().samples;
}

/**
 * A grid of samples in one call: sample (i, j) is at (ox + i * step, oz + j * step), its h, dx, dz at
 * 3 * (j * nx + i) of the returned array. The array is the kernel's own, overwritten by the next call into the
 * kernel: copy what is kept. Throws when the grid is larger than `kernelGridCapacity()`.
 */
export function kernelMontaneGrid(handle: number, seed: number, ox: number, oz: number, step: number, nx: number, nz: number): Float64Array {
  const k = load();
  const made = k.ex.montane_grid(handle, seed, ox, oz, step, nx, nz);
  if (made !== nx * nz) throw new Error(`a grid of ${nx} by ${nz} samples does not fit the field kernel (${k.samples} at most)`);
  return k.out.subarray(0, made * 3);
}
