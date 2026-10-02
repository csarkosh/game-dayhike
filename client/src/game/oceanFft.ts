/**
 * The wind sea's FFT on the CPU, Babylon-free and tested under Node: the
 * reference the high tier's WebGPU passes are held to (`oceanGpuFft.ts`), and
 * the engine of the medium tier's loop, baked on a worker.
 *
 * Conventions, shared with the WGSL in shaders/oceanFft*.compute.wgsl:
 * - A grid of n × n (n a power of two) is stored row by row: index
 *   row·n + col. In the spectrum the column is the x frequency and the row
 *   the z frequency, in FFT order (`fftWaveIndex`: 0 … n/2 − 1, then −n/2 … −1),
 *   so the wavenumber of column m on a tile `size` metres across is
 *   2π·fftWaveIndex(m, n)/size. In the field the column is x and the row z,
 *   sample (col, row) at (col, row)·size/n.
 * - The inverse transform is unnormalised: h(x) = Σ_k H(k) e^{+i k·x}.
 * - Each component travels along +k: H(k, t) = h0(k) e^{−iωt} + conj(h0(−k)) e^{+iωt}.
 * - The horizontal displacement is D(k) = i (k/|k|) H(k), so a wave
 *   A cos(k·x − ωt) is displaced by −k̂ A sin(k·x − ωt): points gather under
 *   the crest and the crest sharpens, as the swell's trochoid does (the
 *   design's §5), and the Jacobian folds at the crest.
 *
 * Render-side only; `Math.cos` and friends are fine here.
 * See docs/rendering/2026-10-02-ocean-waves-design.md §6.
 */

/** A spectrum's starting amplitudes and each bin's angular frequency, n × n. */
export type SpectrumH0 = { re: Float32Array; im: Float32Array; omega: Float32Array };
/** A complex grid as its real and imaginary parts. */
export type ComplexGrid = [Float32Array, Float32Array];
/** The complex spectra of the wind sea's fields at one time: the height, the
 * horizontal displacement (unscaled by the choppiness), the slopes, and the
 * displacement's derivatives the Jacobian is made of. */
export type WindSeaSpectra = {
  height: ComplexGrid;
  dx: ComplexGrid;
  dz: ComplexGrid;
  sx: ComplexGrid;
  sz: ComplexGrid;
  /** ∂dx/∂x, ∂dz/∂z and ∂dx/∂z (= ∂dz/∂x). */
  dxdx: ComplexGrid;
  dzdz: ComplexGrid;
  dxdz: ComplexGrid;
};
/** One frame of the wind sea in space, n × n each. */
export type WindSeaFields = {
  height: Float32Array;
  dx: Float32Array;
  dz: Float32Array;
  slopeX: Float32Array;
  slopeZ: Float32Array;
  jacobian: Float32Array;
};

/** The choppiness λ the high tier displaces its wind sea by: the trochoid's
 * own (a wave A cos θ is displaced by λ·A sin θ), so the crests sharpen as the
 * swell's do and fold where the sea is steep. */
export const WIND_SEA_CHOPPINESS = 1;

const PI = Math.PI;

/** Frequency index m of an n-point FFT as a signed wave index: 0 … n/2 − 1, then −n/2 … −1. */
export function fftWaveIndex(m: number, n: number): number {
  return m < n / 2 ? m : m - n;
}

/**
 * One line's inverse FFT, in place: the n values at `offset`, `offset +
 * stride`, … of (re, im). A radix-2 Stockham FFT in the order the GPU pass
 * runs it (shaders/oceanFftPass.compute.wgsl, one workgroup a line): the line
 * is read into a scratch of 2n values (the pass's workgroup array), then
 * log2(n) stages each read one half of the scratch and write the other,
 * invocation j of n/2 taking the butterfly of elements j and j + n/2. The
 * lines marked `stockham:` are the pass's own, token for token but for
 * WGSL's casts, its unsigned literals and its constant N for n
 * (`oceanGpuFft.test.ts` compares them). `scratchRe` and `scratchIm` hold at
 * least 2n values.
 */
export function fftInverseLine(
  re: Float32Array,
  im: Float32Array,
  offset: number,
  stride: number,
  n: number,
  scratchRe: Float64Array,
  scratchIm: Float64Array,
): void {
  const half = n >> 1;
  const stages = Math.round(Math.log2(n));
  for (let j = 0; j < half; j++) {
    scratchRe[j] = re[offset + j * stride]!;
    scratchIm[j] = im[offset + j * stride]!;
    scratchRe[j + half] = re[offset + (j + half) * stride]!;
    scratchIm[j + half] = im[offset + (j + half) * stride]!;
  }
  for (let stage = 0; stage < stages; stage++) {
    const src = (stage & 1) * n; // stockham: src
    const dst = n - src; // stockham: dst
    const span = 1 << stage; // stockham: span
    for (let j = 0; j < half; j++) {
      const r = j & (span - 1); // stockham: r
      const angle = (PI * r) / span; // stockham: angle
      const dest = ((j >> stage) << (stage + 1)) + r; // stockham: dest
      const wr = Math.cos(angle);
      const wi = Math.sin(angle);
      const ar = scratchRe[src + j]!;
      const ai = scratchIm[src + j]!;
      const cr = scratchRe[src + j + half]!;
      const ci = scratchIm[src + j + half]!;
      const br = cr * wr - ci * wi;
      const bi = cr * wi + ci * wr;
      scratchRe[dst + dest] = ar + br;
      scratchIm[dst + dest] = ai + bi;
      scratchRe[dst + dest + span] = ar - br;
      scratchIm[dst + dest + span] = ai - bi;
    }
  }
  const out = (stages & 1) * n;
  for (let j = 0; j < n; j++) {
    re[offset + j * stride] = scratchRe[out + j]!;
    im[offset + j * stride] = scratchIm[out + j]!;
  }
}

/**
 * The 2-D inverse FFT of an n × n grid, in place (n a power of two): every
 * row (along x), then every column (along z), each by `fftInverseLine`, the
 * order of the GPU's two dispatches. Values are stored as 32-bit floats
 * between the passes, as the GPU stores them.
 */
export function fft2dInverse(re: Float32Array, im: Float32Array, n: number): void {
  const scratchRe = new Float64Array(2 * n);
  const scratchIm = new Float64Array(2 * n);
  for (let row = 0; row < n; row++) fftInverseLine(re, im, row * n, 1, n, scratchRe, scratchIm);
  for (let col = 0; col < n; col++) fftInverseLine(re, im, col, n, n, scratchRe, scratchIm);
}

/** The direct inverse DFT, out(x, z) = Σ in(m, l) e^{2πi (m x + l z)/n}: the reference for the tests. */
export function dft2dInverse(re: Float32Array, im: Float32Array, n: number): { re: Float32Array; im: Float32Array } {
  const cos = new Float64Array(n);
  const sin = new Float64Array(n);
  for (let q = 0; q < n; q++) {
    cos[q] = Math.cos((2 * PI * q) / n);
    sin[q] = Math.sin((2 * PI * q) / n);
  }
  const outRe = new Float32Array(n * n);
  const outIm = new Float32Array(n * n);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      let sr = 0;
      let si = 0;
      for (let l = 0; l < n; l++) {
        for (let m = 0; m < n; m++) {
          const q = (m * x + l * z) % n;
          const a = re[l * n + m]!;
          const b = im[l * n + m]!;
          sr += a * cos[q]! - b * sin[q]!;
          si += a * sin[q]! + b * cos[q]!;
        }
      }
      outRe[z * n + x] = sr;
      outIm[z * n + x] = si;
    }
  }
  return { re: outRe, im: outIm };
}

function grid(n: number): ComplexGrid {
  return [new Float32Array(n * n), new Float32Array(n * n)];
}

/**
 * The wind sea's spectra at time t (s) on a tile `size` metres across:
 * H(k, t) = h0(k) e^{−iωt} + conj(h0(−k)) e^{iωt}, and from it the
 * displacement i k̂ H, the slopes i k H and the displacement's derivatives
 * −(kₐ k_b / |k|) H. The DC bin carries no displacement.
 */
export function evolveSpectrum(h0: SpectrumH0, n: number, size: number, t: number): WindSeaSpectra {
  const out: WindSeaSpectra = {
    height: grid(n), dx: grid(n), dz: grid(n), sx: grid(n), sz: grid(n),
    dxdx: grid(n), dzdz: grid(n), dxdz: grid(n),
  };
  const dk = (2 * PI) / size;
  for (let row = 0; row < n; row++) {
    const kz = dk * fftWaveIndex(row, n);
    const mirrorRow = (n - row) % n;
    for (let col = 0; col < n; col++) {
      const kx = dk * fftWaveIndex(col, n);
      const i = row * n + col;
      const mirror = mirrorRow * n + ((n - col) % n);
      const phase = h0.omega[i]! * t;
      const c = Math.cos(phase);
      const s = Math.sin(phase);
      const a = h0.re[i]!;
      const b = h0.im[i]!;
      const am = h0.re[mirror]!;
      const bm = h0.im[mirror]!;
      // (a + ib) e^{−iωt} + (am − i bm) e^{iωt}
      const hr = a * c + b * s + am * c + bm * s;
      const hi = b * c - a * s + am * s - bm * c;
      out.height[0][i] = hr;
      out.height[1][i] = hi;
      const k = Math.hypot(kx, kz);
      if (k === 0) continue;
      const ux = kx / k;
      const uz = kz / k;
      // i·u·H = u·(−hi, hr)
      out.dx[0][i] = -ux * hi;
      out.dx[1][i] = ux * hr;
      out.dz[0][i] = -uz * hi;
      out.dz[1][i] = uz * hr;
      out.sx[0][i] = -kx * hi;
      out.sx[1][i] = kx * hr;
      out.sz[0][i] = -kz * hi;
      out.sz[1][i] = kz * hr;
      out.dxdx[0][i] = -kx * ux * hr;
      out.dxdx[1][i] = -kx * ux * hi;
      out.dzdz[0][i] = -kz * uz * hr;
      out.dzdz[1][i] = -kz * uz * hi;
      out.dxdz[0][i] = -kx * uz * hr;
      out.dxdz[1][i] = -kx * uz * hi;
    }
  }
  return out;
}

/** A + i·B for the spectra of two real fields: its inverse is a(x) + i·b(x). */
function pack(a: ComplexGrid, b: ComplexGrid): ComplexGrid {
  const re = new Float32Array(a[0].length);
  const im = new Float32Array(a[0].length);
  for (let i = 0; i < re.length; i++) {
    re[i] = a[0][i]! - b[1][i]!;
    im[i] = a[1][i]! + b[0][i]!;
  }
  return [re, im];
}

/**
 * One frame of the wind sea on the CPU, the reference of a whole GPU frame:
 * the spectra at t, packed two real fields to a complex grid as the GPU
 * packs them (height + i·dx, dz + i·slopeX, slopeZ + i·∂dx/∂x,
 * ∂dz/∂z + i·∂dx/∂z), four inverse FFTs, then the displacement scaled by the
 * choppiness λ and the Jacobian
 * J = (1 + λ ∂dx/∂x)(1 + λ ∂dz/∂z) − λ² (∂dx/∂z)².
 */
export function windSeaFields(h0: SpectrumH0, n: number, size: number, t: number, choppiness: number): WindSeaFields {
  const s = evolveSpectrum(h0, n, size, t);
  const grids = [pack(s.height, s.dx), pack(s.dz, s.sx), pack(s.sz, s.dxdx), pack(s.dzdz, s.dxdz)];
  for (const [re, im] of grids) fft2dInverse(re, im, n);
  const [g0, g1, g2, g3] = grids as [ComplexGrid, ComplexGrid, ComplexGrid, ComplexGrid];
  const count = n * n;
  const out: WindSeaFields = {
    height: new Float32Array(count), dx: new Float32Array(count), dz: new Float32Array(count),
    slopeX: new Float32Array(count), slopeZ: new Float32Array(count), jacobian: new Float32Array(count),
  };
  const l = choppiness;
  for (let i = 0; i < count; i++) {
    out.height[i] = g0[0][i]!;
    out.dx[i] = l * g0[1][i]!;
    out.dz[i] = l * g1[0][i]!;
    out.slopeX[i] = g1[1][i]!;
    out.slopeZ[i] = g2[0][i]!;
    const jxx = g2[1][i]!;
    const jzz = g3[0][i]!;
    const jxz = g3[1][i]!;
    out.jacobian[i] = (1 + l * jxx) * (1 + l * jzz) - l * l * jxz * jxz;
  }
  return out;
}
