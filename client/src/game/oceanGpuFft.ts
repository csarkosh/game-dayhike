/**
 * The high tier's wind sea: three cascades of FFT_N² (FFT_CASCADES metres
 * across) computed each frame in WebGPU compute, read by the sea's material
 * as two texture arrays. The compute shaders are WGSL
 * (shaders/oceanFft*.compute.wgsl), outside the GLSL → WGSL translation the
 * materials take; the CPU reference they mirror is `oceanFft.ts`.
 *
 * A frame is four dispatches (`step`):
 * 1. evolve: every bin of every cascade turned to the frame's time, the
 *    eight fields packed two real fields to a complex value (height + i·dx,
 *    dz + i·slopeX, slopeZ + i·∂dx/∂x, ∂dz/∂z + i·∂dx/∂z) into a storage
 *    buffer of 2 layers a cascade;
 * 2. rows: a workgroup a line, every row of every layer, the 256-point
 *    Stockham FFT in workgroup memory, in place;
 * 3. columns: the same down every column;
 * 4. resolve: the fields out to `disp` (height, dx, dz, Jacobian) and
 *    `slope` (slopeX, slopeZ, 0, 0), rgba16float, a layer a cascade.
 * The spectra live in storage buffers rather than textures: a line is read
 * and written in place by the one workgroup that owns it, so nothing
 * ping-pongs in memory, and no stage binds more than two storage textures
 * (resolve's outputs), inside the device's four.
 *
 * h0 is built on the CPU (`windSeaH0`, about 20 ms for the three cascades)
 * and uploaded by `setSpectrum`, which the caller runs when the wind sea's
 * state has moved by more than a step. Babylon ends the frame's render pass
 * before each dispatch, so `step` belongs before the scene's first pass of
 * the frame (before `scene.render()`).
 *
 * Babylon 9.18's compute API as it stands: `ComputeShader` (constructor with
 * `{ computeSource }` and `{ bindingsMapping, entryPoint }`, `setStorageBuffer`,
 * `setUniformBuffer`, `setStorageTexture`, `isReady`, `dispatch`, `onError`),
 * `StorageBuffer` (`update`, `dispose`), the engine's `createUniformBuffer`,
 * `updateUniformBuffer`, `_releaseBuffer` and `createRawTexture2DArray` with
 * `TEXTURE_CREATIONFLAG_STORAGE`. Every pipeline takes the device's automatic
 * layout: Babylon's explicit one gives a storage texture array a 2-D view.
 *
 * The first frame that dispatches does so inside a validation error scope on
 * the device: a pipeline or a binding the device refuses is reported there,
 * and the wind sea fails (the caller falls back) rather than spoiling every
 * frame's commands after it. Nothing more is dispatched until the scope
 * answers.
 *
 * WebGPU only, and only where the engine reports compute: `createGpuWindSea`
 * returns null on any other engine, and the caller draws the medium tier's
 * loop instead. This module names no module of Babylon's WebGPU engine at run
 * time; the caller may import it dynamically on the WebGPU path alone.
 */
import { ComputeShader } from "@babylonjs/core/Compute/computeShader.pure.js";
import type { ComputeBindingMapping } from "@babylonjs/core/Engines/Extensions/engine.computeShader.pure.js";
import { StorageBuffer } from "@babylonjs/core/Buffers/storageBuffer.js";
import type { DataBuffer } from "@babylonjs/core/Buffers/dataBuffer.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine.js";
import type { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine.js";
import { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture.js";
import evolveSource from "./shaders/oceanFftEvolve.compute.wgsl?raw";
import passSource from "./shaders/oceanFftPass.compute.wgsl?raw";
import resolveSource from "./shaders/oceanFftResolve.compute.wgsl?raw";
import { WIND_SEA_CHOPPINESS } from "./oceanFft.js";
import { FFT_CASCADES, FFT_N, WIND_SEA_REPEAT, cascadeBands, windSeaCascadeSeed, windSeaH0 } from "./oceanSpectrum.js";

export type GpuWindSea = {
  /** (height, dx, dz, Jacobian), a layer a cascade, FFT_N², rgba16float, bilinear, wrapping. */
  disp: BaseTexture;
  /** (slopeX, slopeZ, 0, 0), likewise. */
  slope: BaseTexture;
  /** Rebuilds h0 for the wind sea's state on the CPU and uploads it. */
  setSpectrum(state: { u10: number; dir: [number, number] }, seed: number): void;
  /** One frame at `seconds` on the shared clock: evolve, rows, columns, resolve.
   * Nothing until every shader has compiled, nor while the first frame's
   * validation is awaited; then four dispatches. */
  step(seconds: number): void;
  /** `compiling` until the four shaders are ready, `running` once a frame has
   * been dispatched, `failed` if one did not compile or the device refused the
   * first frame (the caller falls back). */
  status(): "compiling" | "running" | "failed";
  dispose(): void;
};

/** Where each shader's resources are bound, as its WGSL declares them. */
export const OCEAN_FFT_EVOLVE_BINDINGS: ComputeBindingMapping = {
  h0: { group: 0, binding: 0 },
  spectra: { group: 0, binding: 1 },
  params: { group: 0, binding: 2 },
};
export const OCEAN_FFT_PASS_BINDINGS: ComputeBindingMapping = {
  spectra: { group: 0, binding: 0 },
};
export const OCEAN_FFT_RESOLVE_BINDINGS: ComputeBindingMapping = {
  spectra: { group: 0, binding: 0 },
  params: { group: 0, binding: 1 },
  disp: { group: 0, binding: 2 },
  slope: { group: 0, binding: 3 },
};

/** Each dispatch's workgroup counts: a 16 × 16 workgroup per tile of bins or
 * texels of each cascade for evolve and resolve, a workgroup per line of each
 * of the 2 × 3 layers for the passes. */
export const OCEAN_FFT_DISPATCH = {
  evolve: [FFT_N / 16, FFT_N / 16, FFT_CASCADES.length],
  rows: [FFT_N, 2 * FFT_CASCADES.length, 1],
  columns: [FFT_N, 2 * FFT_CASCADES.length, 1],
  resolve: [FFT_N / 16, FFT_N / 16, FFT_CASCADES.length],
} as const;

/** A half float's 1.0: the Jacobian `disp` holds before the first frame, an unfolded sea. */
const HALF_ONE = 0x3c00;

/** The device's error scopes, the part of it the first frame's validation needs. */
type ErrorScopes = Pick<GPUDevice, "pushErrorScope" | "popErrorScope">;

/**
 * What `setSpectrum` uploads: h0 of each cascade for the wind sea's state
 * (`windSeaH0`, its seed `windSeaCascadeSeed(seed, c)`), as the evolve shader
 * reads it: a vec4 (re, im, ω, 0) a bin, cascade after cascade, each in FFT
 * order row by row.
 */
export function gpuWindSeaH0(state: { u10: number; dir: [number, number] }, seed: number): Float32Array {
  const n = FFT_N;
  const bands = cascadeBands(FFT_CASCADES, n);
  const data = new Float32Array(FFT_CASCADES.length * n * n * 4);
  FFT_CASCADES.forEach((size, c) => {
    const cascade = windSeaH0(n, size, state, bands[c]!, windSeaCascadeSeed(seed, c));
    for (let i = 0; i < n * n; i++) {
      const at = (c * n * n + i) * 4;
      data[at] = cascade.re[i]!;
      data[at + 1] = cascade.im[i]!;
      data[at + 2] = cascade.omega[i]!;
    }
  });
  return data;
}

/**
 * The wind sea on the GPU, or null where `engine` is not WebGPU or has no
 * compute. Its textures read a flat, unfolded sea until the first frame.
 */
export function createGpuWindSea(engine: AbstractEngine): GpuWindSea | null {
  if (!engine.isWebGPU || !engine.getCaps().supportComputeShaders) return null;
  const n = FFT_N;
  const cascades = FFT_CASCADES.length;
  const gpu = engine as WebGPUEngine;
  const device: ErrorScopes = gpu._device;

  const h0 = new StorageBuffer(gpu, cascades * n * n * 16, Constants.BUFFER_CREATIONFLAG_WRITE, "oceanFftH0");
  const spectra = new StorageBuffer(gpu, 2 * cascades * n * n * 16, Constants.BUFFER_CREATIONFLAG_READWRITE, "oceanFftSpectra");
  const values = new Float32Array(8);
  values[1] = WIND_SEA_CHOPPINESS;
  FFT_CASCADES.forEach((size, c) => {
    values[4 + c] = size;
  });
  const params: DataBuffer = engine.createUniformBuffer(values, "oceanFftParams");

  const flat = new Uint16Array(n * n * cascades * 4);
  for (let i = 3; i < flat.length; i += 4) flat[i] = HALF_ONE;
  const target = (data: Uint16Array | null, name: string): BaseTexture => {
    const internal = engine.createRawTexture2DArray(
      data, n, n, cascades, Constants.TEXTUREFORMAT_RGBA, false, false, Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
      null, Constants.TEXTURETYPE_HALF_FLOAT, Constants.TEXTURE_CREATIONFLAG_STORAGE,
    );
    const texture = new BaseTexture(engine, internal);
    texture.name = name;
    texture.wrapU = Constants.TEXTURE_WRAP_ADDRESSMODE;
    texture.wrapV = Constants.TEXTURE_WRAP_ADDRESSMODE;
    return texture;
  };
  const disp = target(flat, "oceanWindDisp");
  const slope = target(null, "oceanWindSlope");

  let failed = false;
  let ran = false;
  // The first frame's validation: none asked yet, awaited, or answered clean.
  let validation: "unasked" | "awaited" | "clean" = "unasked";
  let disposed = false;
  const shader = (name: string, source: string, bindingsMapping: ComputeBindingMapping, entryPoint = "main"): ComputeShader => {
    const made = new ComputeShader(name, engine, { computeSource: source }, { bindingsMapping, entryPoint });
    made.onError = (_effect, errors) => {
      if (!failed) console.warn(`Ocean: the wind sea's ${name} shader did not compile; the sea draws without it.`, errors);
      failed = true;
    };
    return made;
  };
  const evolve = shader("oceanFftEvolve", evolveSource, OCEAN_FFT_EVOLVE_BINDINGS);
  const rows = shader("oceanFftRows", passSource, OCEAN_FFT_PASS_BINDINGS, "rows");
  const columns = shader("oceanFftColumns", passSource, OCEAN_FFT_PASS_BINDINGS, "columns");
  const resolve = shader("oceanFftResolve", resolveSource, OCEAN_FFT_RESOLVE_BINDINGS);
  evolve.setStorageBuffer("h0", h0);
  evolve.setStorageBuffer("spectra", spectra);
  evolve.setUniformBuffer("params", params);
  rows.setStorageBuffer("spectra", spectra);
  columns.setStorageBuffer("spectra", spectra);
  resolve.setStorageBuffer("spectra", spectra);
  resolve.setUniformBuffer("params", params);
  resolve.setStorageTexture("disp", disp);
  resolve.setStorageTexture("slope", slope);
  const all = [evolve, rows, columns, resolve];
  // Babylon compiles a compute shader when it is first asked whether it is
  // ready, and each compiles by itself from then on: ask all four now, so they
  // compile together whether or not the sea is in sight.
  for (const s of all) s.isReady();

  return {
    disp,
    slope,
    setSpectrum(state, seed) {
      if (!disposed) h0.update(gpuWindSeaH0(state, seed));
    },
    step(seconds) {
      if (disposed || failed || validation === "awaited") return;
      // Every shader asked each frame, none skipped for another not ready yet.
      if (!all.map((s) => s.isReady()).every(Boolean)) return;
      const folded = seconds - WIND_SEA_REPEAT * Math.floor(seconds / WIND_SEA_REPEAT);
      values[0] = folded;
      engine.updateUniformBuffer(params, values);
      const d = OCEAN_FFT_DISPATCH;
      const first = validation === "unasked";
      if (first) device.pushErrorScope("validation");
      try {
        evolve.dispatch(d.evolve[0], d.evolve[1], d.evolve[2]);
        rows.dispatch(d.rows[0], d.rows[1], d.rows[2]);
        columns.dispatch(d.columns[0], d.columns[1], d.columns[2]);
        resolve.dispatch(d.resolve[0], d.resolve[1], d.resolve[2]);
        ran = true;
      } finally {
        // The scope is popped whatever the dispatches did, so it never holds the device's later errors.
        if (first) {
          validation = "awaited";
          device.popErrorScope().then(
            (error) => {
              if (error === null) {
                validation = "clean";
                return;
              }
              if (!failed) console.warn("Ocean: the device refused the wind sea's first frame; the sea draws without it.", error.message);
              failed = true;
            },
            (reason: unknown) => {
              if (!failed) console.warn("Ocean: the wind sea's first frame could not be checked; the sea draws without it.", reason);
              failed = true;
            },
          );
        }
      }
    },
    status() {
      if (failed) return "failed";
      return ran ? "running" : "compiling";
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      h0.dispose();
      spectra.dispose();
      engine._releaseBuffer(params);
      disp.dispose();
      slope.dispose();
    },
  };
}
