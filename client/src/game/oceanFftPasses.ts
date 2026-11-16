/**
 * The wind sea's FFT as its passes are made and run, with no engine: what
 * each of the three compute shaders (shaders/oceanFft*.compute.wgsl) binds
 * and where, how many workgroups each of a frame's four dispatches takes,
 * the sizes of the buffers and the two pictures they fill, the uniforms a
 * frame writes, and the starting amplitudes a spectrum is uploaded as.
 * Whoever runs the passes (`oceanGpuFft.ts` on Babylon.js) reads them here.
 *
 * A frame is four dispatches:
 * 1. evolve: every bin of every cascade turned to the frame's time, the
 *    eight fields packed two real fields to a complex value into a storage
 *    buffer of 2 layers a cascade;
 * 2. rows: a workgroup a line, every row of every layer, in place;
 * 3. columns: the same down every column;
 * 4. resolve: the fields out to the displacement (height, dx, dz, Jacobian)
 *    and the slopes (slopeX, slopeZ, 0, 0), half floats, a layer a cascade.
 *
 * Render-side only.
 */
import { WIND_SEA_CHOPPINESS } from "./oceanFft.js";
import { FFT_CASCADES, FFT_N, WIND_SEA_REPEAT, cascadeBands, windSeaCascadeSeed, windSeaH0 } from "./oceanSpectrum.js";

/** Where a shader binds one of its resources. */
export type FftBinding = { group: number; binding: number };

/** Where each shader's resources are bound, as its WGSL declares them. */
export const OCEAN_FFT_EVOLVE_BINDINGS: Record<string, FftBinding> = {
  h0: { group: 0, binding: 0 },
  spectra: { group: 0, binding: 1 },
  params: { group: 0, binding: 2 },
};
export const OCEAN_FFT_PASS_BINDINGS: Record<string, FftBinding> = {
  spectra: { group: 0, binding: 0 },
};
export const OCEAN_FFT_RESOLVE_BINDINGS: Record<string, FftBinding> = {
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

/** The starting amplitudes' buffer, bytes: a vec4 a bin of each cascade. */
export const OCEAN_FFT_H0_BYTES = FFT_CASCADES.length * FFT_N * FFT_N * 16;
/** The spectra's buffer, bytes: two layers of vec4 a cascade. */
export const OCEAN_FFT_SPECTRA_BYTES = 2 * FFT_CASCADES.length * FFT_N * FFT_N * 16;
/** The floats of the passes' uniforms: (seconds, choppiness, 0, 0), then the cascades' sizes. */
export const OCEAN_FFT_PARAM_FLOATS = 8;

/** A half float's 1.0: the Jacobian the displacement holds before the first frame, an unfolded sea. */
const HALF_ONE = 0x3c00;

/** The passes' uniforms as they stand before any frame: the choppiness and each cascade's size, the seconds 0. */
export function fftParams(): Float32Array {
  const values = new Float32Array(OCEAN_FFT_PARAM_FLOATS);
  values[1] = WIND_SEA_CHOPPINESS;
  FFT_CASCADES.forEach((size, c) => {
    values[4 + c] = size;
  });
  return values;
}

/** The shared `seconds` as a frame's uniforms take them: folded into the sea's repeat. */
export function fftSeconds(seconds: number): number {
  return seconds - WIND_SEA_REPEAT * Math.floor(seconds / WIND_SEA_REPEAT);
}

/** What the displacement holds before the first frame: a flat sea, unfolded (half floats, four a texel, a layer a cascade). */
export function fftFlatField(): Uint16Array {
  const flat = new Uint16Array(FFT_N * FFT_N * FFT_CASCADES.length * 4);
  for (let i = 3; i < flat.length; i += 4) flat[i] = HALF_ONE;
  return flat;
}

/**
 * What a spectrum is uploaded as: h0 of each cascade for the wind sea's state
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
