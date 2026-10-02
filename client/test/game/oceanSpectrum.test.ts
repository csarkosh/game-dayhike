import { describe, it, expect } from "vitest";
import {
  FFT_N, FFT_CASCADES, LOOP_N, LOOP_SIZE, LOOP_FRAMES, LOOP_SECONDS, WIND_SEA_SALT,
  WIND_SEA_HS_COEFF, WIND_SEA_FP_COEFF, WIND_SEA_SPREAD, WIND_SEA_GAMMA, WIND_SEA_REPEAT,
  jonswap, spreading, cascadeBands, windSeaCascadeSeed, windSeaH0,
} from "../../src/game/oceanSpectrum.js";
import { evolveSpectrum, fft2dInverse, fftWaveIndex } from "../../src/game/oceanFft.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** ∫ S df by the midpoint rule over [lo, hi). */
function integrate(fn: (f: number) => number, lo: number, hi: number, steps: number): number {
  const h = (hi - lo) / steps;
  let sum = 0;
  for (let i = 0; i < steps; i++) sum += fn(lo + (i + 0.5) * h);
  return sum * h;
}

describe("the wind sea's constants", () => {
  it("are the cascades, the loop and the sea state the design sets", () => {
    expect(FFT_N).toBe(256);
    expect([...FFT_CASCADES]).toEqual([1000, 150, 25]);
    expect([LOOP_N, LOOP_SIZE, LOOP_FRAMES, LOOP_SECONDS]).toEqual([128, 60, 64, 20]);
    expect(WIND_SEA_SALT).toBe(0x0ce4);
    expect([WIND_SEA_HS_COEFF, WIND_SEA_FP_COEFF, WIND_SEA_SPREAD, WIND_SEA_GAMMA]).toEqual([0.28, 0.123, 10, 3.3]);
    expect(WIND_SEA_REPEAT).toBe(1024);
  });
});

describe("JONSWAP", () => {
  it("is normalised so that 4√(∫S df) is the significant height", () => {
    const cases: [number, number, number][] = [[0.1, 2, 3.3], [0.3, 0.5, 1], [0.07, 4, 7], [0.12, 2.85, 3.3]];
    for (const [fp, hs, gamma] of cases) {
      const m0 = integrate((f) => jonswap(f, fp, hs, gamma), 0, 5, 500_000);
      expect(Math.abs(4 * Math.sqrt(m0) - hs) / hs).toBeLessThan(1e-4);
    }
  });

  it("peaks at fp, and at γ = 1 is Pierson–Moskowitz's shape", () => {
    expect(jonswap(0.1, 0.1, 2, 3.3)).toBeGreaterThan(jonswap(0.095, 0.1, 2, 3.3));
    expect(jonswap(0.1, 0.1, 2, 3.3)).toBeGreaterThan(jonswap(0.105, 0.1, 2, 3.3));
    for (const x of [0.8, 1.2, 2, 4]) {
      const pm = Math.pow(1 / x, 5) * Math.exp(-1.25 * (Math.pow(1 / x, 4) - 1));
      expect(jonswap(0.1 * x, 0.1, 2, 1) / jonswap(0.1, 0.1, 2, 1)).toBeCloseTo(pm, 9);
    }
  });

  it("is zero at and below f = 0, and for no sea", () => {
    expect(jonswap(0, 0.1, 2, 3.3)).toBe(0);
    expect(jonswap(-0.1, 0.1, 2, 3.3)).toBe(0);
    expect(jonswap(0.1, 0, 2, 3.3)).toBe(0);
    expect(jonswap(0.1, 0.1, 0, 3.3)).toBe(0);
  });
});

describe("cos-2s spreading", () => {
  it("integrates to 1 over a turn for every s", () => {
    for (const s of [0, 1, 2.5, 10, 25, 75]) {
      expect(integrate((theta) => spreading(theta, s), -Math.PI, Math.PI, 100_000)).toBeCloseTo(1, 8);
    }
  });

  it("peaks along the mean direction, is symmetric, wraps every turn and is zero straight against it", () => {
    expect(spreading(0, 10)).toBeCloseTo(0.903278, 5);
    expect(spreading(0.3, 10)).toBeLessThan(spreading(0, 10));
    expect(spreading(-0.4, 10)).toBeCloseTo(spreading(0.4, 10), 12);
    expect(spreading(0.4 + 2 * Math.PI, 10)).toBeCloseTo(spreading(0.4, 10), 12);
    expect(spreading(Math.PI, 10)).toBeLessThan(1e-12);
    expect(spreading(1, 0)).toBeCloseTo(1 / (2 * Math.PI), 12);
  });
});

describe("the cascades' bands", () => {
  const bands = cascadeBands(FFT_CASCADES, FFT_N);

  it("run from 0 to the finest cascade's Nyquist wavenumber, each ending at four of the next cascade's fundamentals", () => {
    expect(bands.length).toBe(3);
    expect(bands[0]!.kMin).toBe(0);
    expect(bands[0]!.kMax).toBeCloseTo(0.1675516, 6);
    expect(bands[1]!.kMin).toBeCloseTo(0.1675516, 6);
    expect(bands[1]!.kMax).toBeCloseTo(1.0053096, 6);
    expect(bands[2]!.kMin).toBeCloseTo(1.0053096, 6);
    expect(bands[2]!.kMax).toBeCloseTo(32.1699088, 6);
  });

  it("are contiguous and do not overlap, and each fits under its own cascade's Nyquist wavenumber", () => {
    for (let i = 0; i < bands.length; i++) {
      expect(bands[i]!.kMin).toBeLessThan(bands[i]!.kMax);
      if (i > 0) expect(bands[i]!.kMin).toBe(bands[i - 1]!.kMax);
      expect(bands[i]!.kMax).toBeLessThanOrEqual((Math.PI * FFT_N) / FFT_CASCADES[i]! + 1e-12);
    }
  });
});

describe("the wind sea's h0", () => {
  const bands = cascadeBands(FFT_CASCADES, FFT_N);
  const state = { u10: 10, dir: [0.6, 0.8] as [number, number] };

  it("is the same for the same seed, and another for another seed", () => {
    const a = windSeaH0(64, 150, state, bands[1]!, 7);
    const b = windSeaH0(64, 150, state, bands[1]!, 7);
    const c = windSeaH0(64, 150, state, bands[1]!, 8);
    expect(b.re).toEqual(a.re);
    expect(b.im).toEqual(a.im);
    expect(b.omega).toEqual(a.omega);
    expect(c.re).not.toEqual(a.re);
    expect(windSeaCascadeSeed(7, 0)).not.toBe(windSeaCascadeSeed(7, 1));
  });

  it("is zero outside the band, at the DC bin and on the Nyquist row and column", () => {
    const n = 64;
    const size = 150;
    const h0 = windSeaH0(n, size, state, bands[1]!, 7);
    let inside = 0;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const k = ((2 * Math.PI) / size) * Math.hypot(fftWaveIndex(col, n), fftWaveIndex(row, n));
        const i = row * n + col;
        const outside = k < bands[1]!.kMin || k >= bands[1]!.kMax || row === n / 2 || col === n / 2 || k === 0;
        if (outside) {
          expect(h0.re[i]).toBe(0);
          expect(h0.im[i]).toBe(0);
        } else if (h0.re[i] !== 0) {
          inside++;
        }
      }
    }
    expect(inside).toBeGreaterThan(100);
  });

  it("has deep water's dispersion, ω = √(g|k|) rounded to a multiple of 2π/1024", () => {
    const n = 32;
    const size = 25;
    const h0 = windSeaH0(n, size, state, bands[2]!, 3);
    const quantum = (2 * Math.PI) / 1024;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const k = ((2 * Math.PI) / size) * Math.hypot(fftWaveIndex(col, n), fftWaveIndex(row, n));
        const w = h0.omega[row * n + col]!;
        expect(Math.abs(w - Math.sqrt(9.81 * k))).toBeLessThanOrEqual(quantum / 2 + 1e-5);
        expect(Math.abs(w / quantum - Math.round(w / quantum))).toBeLessThan(1e-3);
      }
    }
  });

  it("is still for no wind", () => {
    const h0 = windSeaH0(32, 150, { u10: 0, dir: [1, 0] }, bands[1]!, 3);
    expect(h0.re.every((v) => v === 0)).toBe(true);
    expect(h0.im.every((v) => v === 0)).toBe(true);
  });

  it("puts its energy downwind", () => {
    const n = 64;
    const h0 = windSeaH0(n, 1000, state, bands[0]!, 11);
    let down = 0;
    let up = 0;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const along = fftWaveIndex(col, n) * 0.6 + fftWaveIndex(row, n) * 0.8;
        const energy = h0.re[row * n + col]! ** 2 + h0.im[row * n + col]! ** 2;
        if (along > 0) down += energy;
        else if (along < 0) up += energy;
      }
    }
    expect(down).toBeGreaterThan(100 * up);
  });

  it("gives a field whose variance, over 32 seeds, is within 10 % of its band's share of the spectrum, on every cascade", () => {
    const hs = (0.28 * 10 * 10) / 9.81;
    const fp = (0.123 * 9.81) / 10;
    for (let c = 0; c < 3; c++) {
      const band = bands[c]!;
      const fLo = Math.sqrt(9.81 * band.kMin) / (2 * Math.PI);
      const fHi = Math.sqrt(9.81 * band.kMax) / (2 * Math.PI);
      const share = integrate((f) => jonswap(f, fp, hs, 3.3), fLo, fHi, 200_000);
      let mean = 0;
      for (let s = 0; s < 32; s++) {
        const h0 = windSeaH0(FFT_N, FFT_CASCADES[c]!, state, band, windSeaCascadeSeed(20261002 + s, c));
        const spectrum = evolveSpectrum(h0, FFT_N, FFT_CASCADES[c]!, 0);
        let variance = 0;
        for (let i = 0; i < FFT_N * FFT_N; i++) variance += spectrum.height[0][i]! ** 2 + spectrum.height[1][i]! ** 2;
        mean += variance / 32;
      }
      expect(Math.abs(mean / share - 1)).toBeLessThan(0.1);
    }
  }, timeLimit(60_000));

  it("by Parseval: the field's mean square is the spectrum's sum of squares", () => {
    const n = 64;
    const h0 = windSeaH0(n, 150, state, bands[1]!, 5);
    const spectrum = evolveSpectrum(h0, n, 150, 0);
    let sum = 0;
    for (let i = 0; i < n * n; i++) sum += spectrum.height[0][i]! ** 2 + spectrum.height[1][i]! ** 2;
    const [re, im] = spectrum.height;
    fft2dInverse(re, im, n);
    let meanSquare = 0;
    for (let i = 0; i < n * n; i++) meanSquare += re[i]! ** 2 / (n * n);
    expect(Math.abs(meanSquare / sum - 1)).toBeLessThan(1e-4);
  });
});
