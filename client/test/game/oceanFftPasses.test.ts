import { describe, it, expect } from "vitest";
import {
  OCEAN_FFT_DISPATCH, OCEAN_FFT_EVOLVE_BINDINGS, OCEAN_FFT_H0_BYTES, OCEAN_FFT_PARAM_FLOATS, OCEAN_FFT_PASS_BINDINGS, OCEAN_FFT_RESOLVE_BINDINGS,
  OCEAN_FFT_SPECTRA_BYTES, fftFlatField, fftParams, fftSeconds, gpuWindSeaH0,
} from "@csarkosh/engine/game/oceanFftPasses";
import { WIND_SEA_CHOPPINESS } from "@csarkosh/engine/game/oceanFft";
import { FFT_CASCADES, FFT_N, WIND_SEA_REPEAT, cascadeBands, windSeaCascadeSeed, windSeaH0 } from "@csarkosh/engine/game/oceanSpectrum";

describe("the wind sea's FFT as its passes are made and run", () => {
  it("names each shader's resources once, at a binding of its own", () => {
    for (const bindings of [OCEAN_FFT_EVOLVE_BINDINGS, OCEAN_FFT_PASS_BINDINGS, OCEAN_FFT_RESOLVE_BINDINGS]) {
      const places = Object.values(bindings).map((b) => `${b.group}:${b.binding}`);
      expect(new Set(places).size).toBe(places.length);
    }
    expect(Object.keys(OCEAN_FFT_EVOLVE_BINDINGS)).toEqual(["h0", "spectra", "params"]);
    expect(Object.keys(OCEAN_FFT_PASS_BINDINGS)).toEqual(["spectra"]);
    expect(Object.keys(OCEAN_FFT_RESOLVE_BINDINGS)).toEqual(["spectra", "params", "disp", "slope"]);
  });

  it("is four dispatches a frame: a tile of bins or texels a workgroup, and a line a workgroup for the two passes", () => {
    const groups = (d: readonly number[]): number => (d[0] as number) * (d[1] as number) * (d[2] as number);
    expect(groups(OCEAN_FFT_DISPATCH.evolve)).toBe((FFT_N / 16) ** 2 * FFT_CASCADES.length);
    expect(groups(OCEAN_FFT_DISPATCH.rows)).toBe(FFT_N * 2 * FFT_CASCADES.length);
    expect(groups(OCEAN_FFT_DISPATCH.columns)).toBe(FFT_N * 2 * FFT_CASCADES.length);
    expect(groups(OCEAN_FFT_DISPATCH.resolve)).toBe((FFT_N / 16) ** 2 * FFT_CASCADES.length);
  });

  it("sizes the buffers by the cascades: a vec4 a bin of the amplitudes, two layers of them for the spectra", () => {
    expect(OCEAN_FFT_H0_BYTES).toBe(3 * 256 * 256 * 16);
    expect(OCEAN_FFT_SPECTRA_BYTES).toBe(2 * OCEAN_FFT_H0_BYTES);
    expect(gpuWindSeaH0({ u10: 8, dir: [1, 0] }, 7).byteLength).toBe(OCEAN_FFT_H0_BYTES);
  });

  it("writes a frame's uniforms as the shaders' struct reads them: the seconds folded, the choppiness, then the cascades' sizes", () => {
    const values = fftParams();
    expect(values.length).toBe(OCEAN_FFT_PARAM_FLOATS);
    expect(Array.from(values)).toEqual([0, WIND_SEA_CHOPPINESS, 0, 0, ...FFT_CASCADES, 0]);
    expect(fftSeconds(12.5)).toBe(12.5);
    expect(fftSeconds(WIND_SEA_REPEAT + 3)).toBe(3);
    expect(fftSeconds(-1)).toBe(WIND_SEA_REPEAT - 1);
  });

  it("holds a flat, unfolded sea before the first frame: no height, no displacement, a Jacobian of one", () => {
    const flat = fftFlatField();
    expect(flat.length).toBe(FFT_N * FFT_N * FFT_CASCADES.length * 4);
    expect([flat[0], flat[1], flat[2], flat[3]]).toEqual([0, 0, 0, 0x3c00]);
    let ones = 0;
    for (let i = 0; i < flat.length; i++) if (flat[i] !== 0) ones++;
    expect(ones).toBe(flat.length / 4);
  });

  it("uploads each cascade's starting amplitudes as (re, im, omega, 0) a bin, the same for the same wind and seed", () => {
    const state = { u10: 9, dir: [1, 0] as [number, number] };
    const data = gpuWindSeaH0(state, 0x5eed);
    expect(Array.from(gpuWindSeaH0(state, 0x5eed).subarray(0, 4096))).toEqual(Array.from(data.subarray(0, 4096)));
    const bands = cascadeBands(FFT_CASCADES, FFT_N);
    FFT_CASCADES.forEach((size, c) => {
      const h0 = windSeaH0(FFT_N, size, state, bands[c]!, windSeaCascadeSeed(0x5eed, c));
      for (const i of [0, 1, 257, 4000, FFT_N * FFT_N - 1]) {
        const at = (c * FFT_N * FFT_N + i) * 4;
        expect([data[at], data[at + 1], data[at + 2], data[at + 3]]).toEqual([h0.re[i], h0.im[i], h0.omega[i], 0]);
      }
    });
    // Another seed is another sea.
    expect(Array.from(gpuWindSeaH0(state, 0x5eee).subarray(0, 4096))).not.toEqual(Array.from(data.subarray(0, 4096)));
  });
});
