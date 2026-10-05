import { describe, it, expect } from "vitest";
import {
  WIND_SEA_CHOPPINESS, fftWaveIndex, fftInverseLine, fft2dInverse, dft2dInverse, evolveSpectrum, windSeaFields,
  type SpectrumH0,
} from "../../src/game/oceanFft.js";
import { cascadeBands, windSeaH0 } from "../../src/game/oceanSpectrum.js";
import { timeLimit } from "../helpers/timeLimit.js";

/** Deterministic numbers in [−1, 1) (mulberry32). */
function randoms(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

function randomGrid(n: number, seed: number): [Float32Array, Float32Array] {
  const next = randoms(seed);
  const re = new Float32Array(n * n);
  const im = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    re[i] = next();
    im[i] = next();
  }
  return [re, im];
}

/** A spectrum of one wave: h0 = amplitude/2 at (col, row), so the field is amplitude·cos(k·x − ωt). */
function oneWave(n: number, col: number, row: number, amplitude: number, omega: number): SpectrumH0 {
  const h0: SpectrumH0 = { re: new Float32Array(n * n), im: new Float32Array(n * n), omega: new Float32Array(n * n) };
  h0.re[row * n + col] = amplitude / 2;
  h0.omega[row * n + col] = omega;
  h0.omega[((n - row) % n) * n + ((n - col) % n)] = omega;
  return h0;
}

describe("the inverse FFT", () => {
  it("numbers frequencies in FFT order", () => {
    expect([0, 1, 7, 8, 9, 15].map((m) => fftWaveIndex(m, 16))).toEqual([0, 1, 7, -8, -7, -1]);
  });

  it("equals the direct inverse DFT within 1e-4 on random 8², 16² and 32² grids", () => {
    for (const n of [8, 16, 32]) {
      const [re, im] = randomGrid(n, n);
      const expected = dft2dInverse(re, im, n);
      fft2dInverse(re, im, n);
      for (let i = 0; i < n * n; i++) {
        expect(Math.abs(re[i]! - expected.re[i]!)).toBeLessThan(1e-4);
        expect(Math.abs(im[i]! - expected.im[i]!)).toBeLessThan(1e-4);
      }
    }
  }, timeLimit(30_000));

  it("transforms one strided line of 256 as the 1-D inverse DFT does", () => {
    const n = 256;
    const stride = 3;
    const next = randoms(256);
    const re = new Float32Array(n * stride + 1);
    const im = new Float32Array(n * stride + 1);
    for (let i = 0; i < n; i++) {
      re[1 + i * stride] = next();
      im[1 + i * stride] = next();
    }
    const inRe = Array.from({ length: n }, (_, i) => re[1 + i * stride]!);
    const inIm = Array.from({ length: n }, (_, i) => im[1 + i * stride]!);
    fftInverseLine(re, im, 1, stride, n, new Float64Array(2 * n), new Float64Array(2 * n));
    for (let x = 0; x < n; x++) {
      let sr = 0;
      let si = 0;
      for (let m = 0; m < n; m++) {
        const a = (2 * Math.PI * ((m * x) % n)) / n;
        sr += inRe[m]! * Math.cos(a) - inIm[m]! * Math.sin(a);
        si += inRe[m]! * Math.sin(a) + inIm[m]! * Math.cos(a);
      }
      expect(Math.abs(re[1 + x * stride]! - sr)).toBeLessThan(1e-4);
      expect(Math.abs(im[1 + x * stride]! - si)).toBeLessThan(1e-4);
    }
  });
});

describe("the wind sea's evolution", () => {
  const n = 16;
  const size = 64;
  const g = 9.81;

  it("turns one wave's spectrum into that cosine, moving along +k at ω", () => {
    const col = 3;
    const row = 14; // z wave index −2
    const kx = (2 * Math.PI * 3) / size;
    const kz = (2 * Math.PI * -2) / size;
    const k = Math.hypot(kx, kz);
    const omega = Math.sqrt(g * k);
    const h0 = oneWave(n, col, row, 0.8, omega);
    for (const t of [0, 1.3]) {
      const fields = windSeaFields(h0, n, size, t, 1);
      for (let z = 0; z < n; z++) {
        for (let x = 0; x < n; x++) {
          const theta = kx * ((x * size) / n) + kz * ((z * size) / n) - omega * t;
          const i = z * n + x;
          expect(fields.height[i]).toBeCloseTo(0.8 * Math.cos(theta), 5);
          // The crest sharpens: points gather under it (−k̂ A sin θ).
          expect(fields.dx[i]).toBeCloseTo(-(kx / k) * 0.8 * Math.sin(theta), 5);
          expect(fields.dz[i]).toBeCloseTo(-(kz / k) * 0.8 * Math.sin(theta), 5);
          expect(fields.slopeX[i]).toBeCloseTo(-kx * 0.8 * Math.sin(theta), 5);
          expect(fields.slopeZ[i]).toBeCloseTo(-kz * 0.8 * Math.sin(theta), 5);
          // J = 1 − λ A k cos θ for one wave: the fold is at the crest.
          expect(fields.jacobian[i]).toBeCloseTo(1 - 0.8 * k * Math.cos(theta), 5);
        }
      }
    }
  });

  it("gives real fields: every spectrum's inverse has imaginary parts under 1e-5", () => {
    const m = 64;
    const bands = cascadeBands([1000, 150, 25], 256);
    const h0 = windSeaH0(m, 25, { u10: 12, dir: [1, 0] }, { kMin: bands[2]!.kMin, kMax: (Math.PI * m) / 25 }, 9);
    const spectra = evolveSpectrum(h0, m, 25, 37.25);
    for (const [re, im] of Object.values(spectra)) {
      fft2dInverse(re, im, m);
      let largest = 0;
      for (let i = 0; i < m * m; i++) largest = Math.max(largest, Math.abs(im[i]!));
      expect(largest).toBeLessThan(1e-5);
    }
  });

  it("packs two fields a grid as the GPU does, and unpacks to the fields transformed one by one", () => {
    const m = 32;
    const h0 = windSeaH0(m, 150, { u10: 8, dir: [0.8, -0.6] }, { kMin: 0.1, kMax: (Math.PI * m) / 150 }, 4);
    const t = 12.5;
    const fields = windSeaFields(h0, m, 150, t, 0.7);
    const spectra = evolveSpectrum(h0, m, 150, t);
    const alone = (grid: [Float32Array, Float32Array]): Float32Array => {
      const re = grid[0].slice();
      fft2dInverse(re, grid[1].slice(), m);
      return re;
    };
    const height = alone(spectra.height);
    const dx = alone(spectra.dx);
    const sz = alone(spectra.sz);
    const dxdx = alone(spectra.dxdx);
    const dzdz = alone(spectra.dzdz);
    const dxdz = alone(spectra.dxdz);
    for (let i = 0; i < m * m; i++) {
      expect(fields.height[i]).toBeCloseTo(height[i]!, 5);
      expect(fields.dx[i]).toBeCloseTo(0.7 * dx[i]!, 5);
      expect(fields.slopeZ[i]).toBeCloseTo(sz[i]!, 5);
      const j = (1 + 0.7 * dxdx[i]!) * (1 + 0.7 * dzdz[i]!) - 0.49 * dxdz[i]! ** 2;
      expect(fields.jacobian[i]).toBeCloseTo(j, 4);
    }
  });

  it("has a Jacobian of 1 and no displacement everywhere at λ = 0", () => {
    const m = 32;
    const h0 = windSeaH0(m, 25, { u10: 15, dir: [0, 1] }, { kMin: 1, kMax: (Math.PI * m) / 25 }, 2);
    const fields = windSeaFields(h0, m, 25, 3, 0);
    for (let i = 0; i < m * m; i++) {
      expect(fields.jacobian[i]).toBe(1);
      expect(Math.abs(fields.dx[i]!)).toBe(0);
      expect(Math.abs(fields.dz[i]!)).toBe(0);
    }
    expect(fields.height.some((v) => Math.abs(v) > 1e-3)).toBe(true);
  });

  it("repeats every 1024 s, its frequencies rounded to the repeat (to their single precision)", () => {
    const m = 32;
    const h0 = windSeaH0(m, 150, { u10: 10, dir: [1, 0] }, { kMin: 0.1, kMax: (Math.PI * m) / 150 }, 6);
    const a = windSeaFields(h0, m, 150, 40, WIND_SEA_CHOPPINESS);
    const b = windSeaFields(h0, m, 150, 40 + 1024, WIND_SEA_CHOPPINESS);
    for (let i = 0; i < m * m; i++) expect(b.height[i]).toBeCloseTo(a.height[i]!, 3);
    expect(WIND_SEA_CHOPPINESS).toBe(1);
  });
});
