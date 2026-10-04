/**
 * The clear sky's light, computed from how sunlight scatters in air: Rayleigh
 * scattering by the air itself, scattering and absorption by aerosols (Mie),
 * and absorption by ozone, over a spherical planet. The model is Hillaire's
 * (2020, "A Scalable and Production Ready Sky and Atmosphere Rendering
 * Technique"), with his standard Earth atmosphere.
 *
 * Pure and Babylon-free, so every number here is tested under Node, and the
 * same code runs in the sky's worker (`sky.worker.ts`) and, where there is no
 * worker, on the main thread. Two tables depend only on the air and are built
 * once: the transmittance (how much light survives a straight path to the top
 * of the air) and the multiple scattering (Hillaire's isotropic estimate of
 * the light scattered more than once). A slice is the whole sky for one sun
 * altitude, laid out as the dome reads it.
 *
 * Units: kilometres, coefficients per kilometre, and radiance per unit of
 * solar irradiance arriving at the top of the air (1 in each channel). The
 * scene's own scale is applied by the sky's state, not here.
 *
 * Every division is guarded: a value that comes back NaN would poison a
 * whole blended slice, and below the horizon several quantities are exactly 0.
 */
import type { Rgb } from "./colour.js";
import type { Vec3 } from "./sky.js";

/** Planet and air, kilometres; coefficients per kilometre. */
export const SKY_GROUND_KM = 6360;
export const SKY_TOP_KM = 6460;
export const SKY_RAYLEIGH: Rgb = { r: 5.802e-3, g: 13.558e-3, b: 33.1e-3 };
export const SKY_RAYLEIGH_HEIGHT_KM = 8;
export const SKY_MIE_SCATTERING = 3.996e-3;
export const SKY_MIE_ABSORPTION = 4.4e-3;
export const SKY_MIE_HEIGHT_KM = 1.2;
export const SKY_MIE_G = 0.8;
/**
 * Multiplies both aerosol coefficients. Under the standard atmosphere's
 * aerosols the clear noon horizon is about 4 times as bright as the zenith,
 * and fewer aerosols make it brighter still: the zenith, 14 degrees from the
 * noon sun, takes much of its light from the aerosols' forward scattering.
 * This is the smallest scale on a 0.05 grid from 1 up at which the horizon's
 * luminance 2 degrees up (its mean away from the sun) is at most twice the
 * zenith's (1.99; at 3.7 it is 2.01), which keeps noon's sky close to even,
 * as the game's noon has always looked. At the horizon itself, where the
 * ring is read, the noon horizon is 1.72 times the zenith.
 */
export const SKY_MIE_SCALE = 3.75;
export const SKY_OZONE: Rgb = { r: 0.65e-3, g: 1.881e-3, b: 0.085e-3 };
export const SKY_OZONE_PEAK_KM = 25;
export const SKY_OZONE_HALF_WIDTH_KM = 15;
export const SKY_GROUND_ALBEDO = 0.3;
/** The eye's height above the ground. The world's relief is a few hundred metres at most. */
export const SKY_EYE_KM = 0.2;

/** Columns of the transmittance table: mu from -1 to 1. */
export const TRANSMITTANCE_WIDTH = 256;
/** Rows of the transmittance table: height (j / (H - 1))^2 of the air's depth, dense near the ground. */
export const TRANSMITTANCE_HEIGHT = 64;
/** The multiple-scattering table is square: muSun across, height up, at texel centres. */
export const MULTI_SIZE = 32;
/**
 * The least value the multiple-scattering table is read as. The read
 * interpolates the table's logarithm, so it needs a floor under the texels
 * that are 0 (from deep in the earth's shadow the stratified sphere finds no
 * sunlit air). 10^-20 of the solar irradiance is far below anything the
 * scene's largest scale (about 6 x 10^4, the night's) brings into view.
 */
export const MULTI_FLOOR = 1e-20;
/** Directions the multiple scattering integrates over: an 8 x 8 stratified sphere. */
export const MULTI_DIRECTIONS = 64;
export const TRANSMITTANCE_STEPS = 40;
export const MULTI_STEPS = 20;
/**
 * Steps of the view march, from the eye to the top of the air or the ground,
 * spaced by the square of the step's index (VIEW_STEP_AT): doubling them
 * moves the clear noon zenith and horizon by half a per cent.
 */
export const VIEW_STEPS = 24;
/** Rows of a slice, elevation from the nadir to the zenith. */
export const SLICE_ELEVATIONS = 64;
/** Columns of a slice, azimuth 0 to 180 degrees from the sun's. The sky is mirror-symmetric about the sun's vertical plane. */
export const SLICE_AZIMUTHS = 32;
/**
 * The elevation of a slice's horizon ring, degrees: the horizon itself, the
 * ring evaluated grazing it, where the fog meets the dome and the sea meets
 * the sky. A level ray from the eye's height misses the ground (the horizon
 * dips 0.45 degrees below level from 200 m) and is marched to the top of the
 * air like any other.
 */
export const RING_ELEVATION_DEG = 0;

/**
 * The sun altitudes a slice is made at, degrees, ascending: every 0.5 from -18
 * to 12, where the sky's colour changes fastest, then every 2 from 14 to 76,
 * the noon sun's height on the game's arc. 93 altitudes. Written from integer
 * steps, so each value is exact.
 */
export const SLICE_ALTITUDES_DEG: readonly number[] = Object.freeze([
  ...Array.from({ length: 61 }, (_, k) => -18 + k / 2),
  ...Array.from({ length: 32 }, (_, k) => 14 + 2 * k),
]);

export type SkyTables = {
  transmittance: Float32Array;
  multi: Float32Array;
  /** ln(max(multi, MULTI_FLOOR)), texel for texel: what the read interpolates. */
  multiLog: Float32Array;
  mieScale: number;
};
export type SkySlice = {
  altitudeDeg: number;
  /** SLICE_ELEVATIONS x SLICE_AZIMUTHS x 3, row-major (index = (row * SLICE_AZIMUTHS + col) * 3).
   *  Row j holds elevation elevationOfRow(j / (SLICE_ELEVATIONS - 1)); column i holds azimuth
   *  azimuthOfColumn(i / (SLICE_AZIMUTHS - 1)) from the sun's. Radiance per unit solar irradiance. */
  texels: Float32Array;
  /** SLICE_AZIMUTHS x 3: the radiance at RING_ELEVATION_DEG, column i as in texels. */
  ring: Float32Array;
  zenith: Rgb;
  /** Cosine-weighted sky light on level ground per unit solar irradiance, integrated from texels
   *  (rows with elevation > 0, both mirrored halves, trapezoid weights). */
  skyIrradiance: Rgb;
  /** The sun's transmittance at the eye: its colour and strength; 0 when the ray meets the ground. */
  sun: Rgb;
};

const AIR_DEPTH_KM = SKY_TOP_KM - SKY_GROUND_KM;

/**
 * Where each step of the view march samples, as a fraction of the ray's
 * length: step s covers (s / N)^2 to ((s + 1) / N)^2 of it and samples at
 * ((s + 0.5) / N)^2, so the steps are short near the eye, where the air is
 * dense, and long far out, where a ray is high. The whole ray is marched: a
 * ray toward the sun in deep twilight finds its sunlit air hundreds of
 * kilometres out (600 km along the horizon under a sun 11 degrees down).
 */
const VIEW_STEP_AT: Float64Array = Float64Array.from({ length: VIEW_STEPS }, (_, s) => ((s + 0.5) / VIEW_STEPS) ** 2);
/** Each step's width, the same fraction: ((s + 1)^2 - s^2) / N^2. */
const VIEW_STEP_WIDTH: Float64Array = Float64Array.from({ length: VIEW_STEPS }, (_, s) => (2 * s + 1) / VIEW_STEPS ** 2);

/** Isotropic phase: the multiple-scattering term scatters equally every way. */
const ISOTROPIC = 1 / (4 * Math.PI);
const RAYLEIGH_PHASE_K = 3 / (16 * Math.PI);
const MIE_PHASE_K = ((3 / (8 * Math.PI)) * (1 - SKY_MIE_G * SKY_MIE_G)) / (2 + SKY_MIE_G * SKY_MIE_G);

/** The air at one height: Rayleigh scattering per channel, Mie scattering, extinction per channel. */
type Medium = { rr: number; rg: number; rb: number; ms: number; er: number; eg: number; eb: number };

function newMedium(): Medium {
  return { rr: 0, rg: 0, rb: 0, ms: 0, er: 0, eg: 0, eb: 0 };
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function mediumAt(h: number, mieScale: number, out: Medium): void {
  const rayleigh = Math.exp(-h / SKY_RAYLEIGH_HEIGHT_KM);
  const mie = Math.exp(-h / SKY_MIE_HEIGHT_KM);
  const ozone = Math.max(0, 1 - Math.abs(h - SKY_OZONE_PEAK_KM) / SKY_OZONE_HALF_WIDTH_KM);
  const mieAbsorption = SKY_MIE_ABSORPTION * mieScale * mie;
  out.rr = SKY_RAYLEIGH.r * rayleigh;
  out.rg = SKY_RAYLEIGH.g * rayleigh;
  out.rb = SKY_RAYLEIGH.b * rayleigh;
  out.ms = SKY_MIE_SCATTERING * mieScale * mie;
  out.er = out.rr + out.ms + mieAbsorption + SKY_OZONE.r * ozone;
  out.eg = out.rg + out.ms + mieAbsorption + SKY_OZONE.g * ozone;
  out.eb = out.rb + out.ms + mieAbsorption + SKY_OZONE.b * ozone;
}

/**
 * The integral over one step of a source s seen through the step's own
 * extinction: s * (1 - e^(-ext * dt)) / ext, the analytic form, with expm1 so
 * a nearly clear step keeps its precision, and s * dt where the air is empty.
 */
function stepIntegral(s: number, ext: number, dt: number): number {
  return ext > 0 ? (-s * Math.expm1(-ext * dt)) / ext : s * dt;
}

/** Distance from radius r along mu to the top of the air; 0 from above it looking up. */
function rayToTop(r: number, mu: number): number {
  const d = r * r * (mu * mu - 1) + SKY_TOP_KM * SKY_TOP_KM;
  return Math.max(0, -r * mu + Math.sqrt(Math.max(0, d)));
}

/** Distance from radius r along mu to the ground, or -1 when the ray misses it. */
function rayToGround(r: number, mu: number): number {
  if (mu >= 0) return -1;
  const d = r * r * (mu * mu - 1) + SKY_GROUND_KM * SKY_GROUND_KM;
  return d >= 0 ? Math.max(0, -r * mu - Math.sqrt(d)) : -1;
}

/** Bilinear read of a 3-channel table at whole texel (i0, j0) plus fractions (fx, fy). */
function bilinear(table: Float32Array, width: number, i0: number, j0: number, fx: number, fy: number, out: Rgb): void {
  const p00 = (j0 * width + i0) * 3;
  const p01 = p00 + 3;
  const p10 = p00 + width * 3;
  const p11 = p10 + 3;
  const w00 = (1 - fx) * (1 - fy);
  const w01 = fx * (1 - fy);
  const w10 = (1 - fx) * fy;
  const w11 = fx * fy;
  out.r = (table[p00] as number) * w00 + (table[p01] as number) * w01 + (table[p10] as number) * w10 + (table[p11] as number) * w11;
  out.g = (table[p00 + 1] as number) * w00 + (table[p01 + 1] as number) * w01 + (table[p10 + 1] as number) * w10 + (table[p11 + 1] as number) * w11;
  out.b = (table[p00 + 2] as number) * w00 + (table[p01 + 2] as number) * w01 + (table[p10 + 2] as number) * w10 + (table[p11 + 2] as number) * w11;
}

function sampleTransmittance(table: Float32Array, radiusKm: number, mu: number, out: Rgb): void {
  const h = clamp(radiusKm - SKY_GROUND_KM, 0, AIR_DEPTH_KM);
  const fj = Math.sqrt(h / AIR_DEPTH_KM) * (TRANSMITTANCE_HEIGHT - 1);
  const fi = ((clamp(mu, -1, 1) + 1) / 2) * (TRANSMITTANCE_WIDTH - 1);
  const j0 = Math.min(TRANSMITTANCE_HEIGHT - 2, Math.floor(fj));
  const i0 = Math.min(TRANSMITTANCE_WIDTH - 2, Math.floor(fi));
  bilinear(table, TRANSMITTANCE_WIDTH, i0, j0, fi - i0, fj - j0, out);
}

/**
 * The multiple scattering read in its logarithm: exp of the bilinear mix of
 * ln texels between texel centres. Below the horizon the light falls by
 * orders of magnitude from one column to the next, and a linear read there
 * is many times too bright between them.
 */
function sampleMulti(logTable: Float32Array, radiusKm: number, muSun: number, out: Rgb): void {
  const fj = clamp(((radiusKm - SKY_GROUND_KM) / AIR_DEPTH_KM) * MULTI_SIZE - 0.5, 0, MULTI_SIZE - 1);
  const fi = clamp(((clamp(muSun, -1, 1) + 1) / 2) * MULTI_SIZE - 0.5, 0, MULTI_SIZE - 1);
  const j0 = Math.min(MULTI_SIZE - 2, Math.floor(fj));
  const i0 = Math.min(MULTI_SIZE - 2, Math.floor(fi));
  bilinear(logTable, MULTI_SIZE, i0, j0, fi - i0, fj - j0, out);
  out.r = Math.exp(out.r);
  out.g = Math.exp(out.g);
  out.b = Math.exp(out.b);
}

function buildTransmittance(mieScale: number): Float32Array {
  const table = new Float32Array(TRANSMITTANCE_WIDTH * TRANSMITTANCE_HEIGHT * 3);
  const med = newMedium();
  for (let j = 0; j < TRANSMITTANCE_HEIGHT; j++) {
    const r = SKY_GROUND_KM + (j / (TRANSMITTANCE_HEIGHT - 1)) ** 2 * AIR_DEPTH_KM;
    for (let i = 0; i < TRANSMITTANCE_WIDTH; i++) {
      const mu = -1 + (2 * i) / (TRANSMITTANCE_WIDTH - 1);
      const k = (j * TRANSMITTANCE_WIDTH + i) * 3;
      // A ray that meets the ground carries no sunlight: the table holds 0 there.
      if (rayToGround(r, mu) >= 0) continue;
      const dt = rayToTop(r, mu) / TRANSMITTANCE_STEPS;
      let odR = 0;
      let odG = 0;
      let odB = 0;
      for (let s = 0; s < TRANSMITTANCE_STEPS; s++) {
        const t = (s + 0.5) * dt;
        const ri = Math.sqrt(Math.max(0, r * r + t * t + 2 * r * t * mu));
        mediumAt(ri - SKY_GROUND_KM, mieScale, med);
        odR += med.er * dt;
        odG += med.eg * dt;
        odB += med.eb * dt;
      }
      table[k] = Math.exp(-odR);
      table[k + 1] = Math.exp(-odG);
      table[k + 2] = Math.exp(-odB);
    }
  }
  return table;
}

/** The 8 x 8 stratified sphere of directions, x y z, equal-area in the cosine of the polar angle. */
const SPHERE: Float64Array = (() => {
  const out = new Float64Array(MULTI_DIRECTIONS * 3);
  let k = 0;
  for (let a = 0; a < 8; a++) {
    for (let b = 0; b < 8; b++) {
      const theta = Math.acos(1 - (2 * (a + 0.5)) / 8);
      const phi = (2 * Math.PI * (b + 0.5)) / 8;
      out[k++] = Math.sin(theta) * Math.cos(phi);
      out[k++] = Math.cos(theta);
      out[k++] = Math.sin(theta) * Math.sin(phi);
    }
  }
  return out;
})();

/**
 * Hillaire's multiple scattering, Psi = L2 / (1 - F): L2 the light scattered
 * twice toward a point (the sun's single scattering along every direction,
 * plus the ground's albedo bounce), F the fraction of light the air around it
 * scatters back, summed as a geometric series of further orders.
 */
function buildMulti(transmittance: Float32Array, mieScale: number): Float32Array {
  const table = new Float32Array(MULTI_SIZE * MULTI_SIZE * 3);
  const med = newMedium();
  const ts: Rgb = { r: 0, g: 0, b: 0 };
  for (let j = 0; j < MULTI_SIZE; j++) {
    const r = SKY_GROUND_KM + ((j + 0.5) / MULTI_SIZE) * AIR_DEPTH_KM;
    for (let i = 0; i < MULTI_SIZE; i++) {
      const muS = -1 + (2 * (i + 0.5)) / MULTI_SIZE;
      const sx = Math.sqrt(Math.max(0, 1 - muS * muS));
      const sy = muS;
      let l2R = 0;
      let l2G = 0;
      let l2B = 0;
      let fR = 0;
      let fG = 0;
      let fB = 0;
      for (let d = 0; d < MULTI_DIRECTIONS; d++) {
        const dx = SPHERE[d * 3] as number;
        const dy = SPHERE[d * 3 + 1] as number;
        const dz = SPHERE[d * 3 + 2] as number;
        const ground = rayToGround(r, dy);
        const dt = (ground >= 0 ? ground : rayToTop(r, dy)) / MULTI_STEPS;
        let tR = 1;
        let tG = 1;
        let tB = 1;
        for (let s = 0; s < MULTI_STEPS; s++) {
          const t = (s + 0.5) * dt;
          const px = dx * t;
          const py = r + dy * t;
          const pz = dz * t;
          const ri = Math.sqrt(px * px + py * py + pz * pz);
          const muSi = ri > 0 ? (px * sx + py * sy) / ri : 0;
          sampleTransmittance(transmittance, ri, muSi, ts);
          mediumAt(ri - SKY_GROUND_KM, mieScale, med);
          const scR = med.rr + med.ms;
          const scG = med.rg + med.ms;
          const scB = med.rb + med.ms;
          l2R += tR * stepIntegral(ts.r * scR * ISOTROPIC, med.er, dt);
          l2G += tG * stepIntegral(ts.g * scG * ISOTROPIC, med.eg, dt);
          l2B += tB * stepIntegral(ts.b * scB * ISOTROPIC, med.eb, dt);
          fR += tR * stepIntegral(scR, med.er, dt);
          fG += tG * stepIntegral(scG, med.eg, dt);
          fB += tB * stepIntegral(scB, med.eb, dt);
          tR *= Math.exp(-med.er * dt);
          tG *= Math.exp(-med.eg * dt);
          tB *= Math.exp(-med.eb * dt);
        }
        if (ground >= 0) {
          const px = dx * ground;
          const py = r + dy * ground;
          const pz = dz * ground;
          const ri = Math.sqrt(px * px + py * py + pz * pz);
          const muG = ri > 0 ? (px * sx + py * sy) / ri : 0;
          sampleTransmittance(transmittance, ri, muG, ts);
          const lit = (Math.max(0, muG) * SKY_GROUND_ALBEDO) / Math.PI;
          l2R += tR * ts.r * lit;
          l2G += tG * ts.g * lit;
          l2B += tB * ts.b * lit;
        }
      }
      const k = (j * MULTI_SIZE + i) * 3;
      table[k] = l2R / MULTI_DIRECTIONS / Math.max(1e-6, 1 - fR / MULTI_DIRECTIONS);
      table[k + 1] = l2G / MULTI_DIRECTIONS / Math.max(1e-6, 1 - fG / MULTI_DIRECTIONS);
      table[k + 2] = l2B / MULTI_DIRECTIONS / Math.max(1e-6, 1 - fB / MULTI_DIRECTIONS);
    }
  }
  return table;
}

/** The two tables that depend only on the air. `mieScale` multiplies both aerosol coefficients. */
export function buildSkyTables(mieScale: number = SKY_MIE_SCALE): SkyTables {
  if (!Number.isFinite(mieScale) || mieScale < 0) throw new RangeError(`the aerosol scale must be finite and non-negative; got ${mieScale}`);
  const transmittance = buildTransmittance(mieScale);
  const multi = buildMulti(transmittance, mieScale);
  const multiLog = Float32Array.from(multi, (v) => Math.log(Math.max(v, MULTI_FLOOR)));
  return { transmittance, multi, multiLog, mieScale };
}

/** The transmittance from radius radiusKm along mu to the top of the air, read bilinearly from the table. */
export function transmittanceAt(t: SkyTables, radiusKm: number, mu: number): Rgb {
  const out: Rgb = { r: 0, g: 0, b: 0 };
  sampleTransmittance(t.transmittance, radiusKm, mu, out);
  return out;
}

/** The multiple scattering at radius radiusKm under a sun at cosine muSun: bilinear in its logarithm between texel
 *  centres, so exactly a texel at its centre (MULTI_FLOOR for a texel of 0). */
export function multiAt(t: SkyTables, radiusKm: number, muSun: number): Rgb {
  const out: Rgb = { r: 0, g: 0, b: 0 };
  sampleMulti(t.multiLog, radiusKm, muSun, out);
  return out;
}

/** Scratch for the view march, reused across calls: a slice makes 2,080 of them. */
const scratchMedium = newMedium();
const scratchSun: Rgb = { r: 0, g: 0, b: 0 };
const scratchMulti: Rgb = { r: 0, g: 0, b: 0 };

/** One view ray's in-scattered light, into `out`. The sun is (sx, sy, 0), unit. */
function radianceInto(t: SkyTables, x: number, y: number, z: number, sx: number, sy: number, eyeKm: number, out: Rgb): void {
  out.r = 0;
  out.g = 0;
  out.b = 0;
  const length = Math.sqrt(x * x + y * y + z * z);
  // No direction to look along: no light, rather than the NaN of normalising zero.
  if (!(length > 0) || !Number.isFinite(length)) return;
  const dx = x / length;
  const dy = y / length;
  const dz = z / length;
  const r = SKY_GROUND_KM + clamp(eyeKm, 0, AIR_DEPTH_KM);
  const cosTheta = clamp(dx * sx + dy * sy, -1, 1);
  const rayleighPhase = RAYLEIGH_PHASE_K * (1 + cosTheta * cosTheta);
  // Cornette-Shanks. Its denominator is at least (1 - g)^2, never 0.
  const mieDenominator = 1 + SKY_MIE_G * SKY_MIE_G - 2 * SKY_MIE_G * cosTheta;
  const miePhase = (MIE_PHASE_K * (1 + cosTheta * cosTheta)) / (mieDenominator * Math.sqrt(mieDenominator));
  const ground = rayToGround(r, dy);
  const span = ground >= 0 ? ground : rayToTop(r, dy);
  const med = scratchMedium;
  const ts = scratchSun;
  const ms = scratchMulti;
  let tR = 1;
  let tG = 1;
  let tB = 1;
  for (let s = 0; s < VIEW_STEPS; s++) {
    const t0 = span * (VIEW_STEP_AT[s] as number);
    const dt = span * (VIEW_STEP_WIDTH[s] as number);
    const px = dx * t0;
    const py = r + dy * t0;
    const pz = dz * t0;
    const ri = Math.sqrt(px * px + py * py + pz * pz);
    const muS = ri > 0 ? (px * sx + py * sy) / ri : 0;
    sampleTransmittance(t.transmittance, ri, muS, ts);
    sampleMulti(t.multiLog, ri, muS, ms);
    mediumAt(ri - SKY_GROUND_KM, t.mieScale, med);
    const mieIn = med.ms * miePhase;
    out.r += tR * stepIntegral(ts.r * (med.rr * rayleighPhase + mieIn) + ms.r * (med.rr + med.ms), med.er, dt);
    out.g += tG * stepIntegral(ts.g * (med.rg * rayleighPhase + mieIn) + ms.g * (med.rg + med.ms), med.eg, dt);
    out.b += tB * stepIntegral(ts.b * (med.rb * rayleighPhase + mieIn) + ms.b * (med.rb + med.ms), med.eb, dt);
    tR *= Math.exp(-med.er * dt);
    tG *= Math.exp(-med.eg * dt);
    tB *= Math.exp(-med.eb * dt);
  }
}

/** dir: unit, y up; the sun lies in the x-y plane at +x, sunAltitude radians. Never NaN, never < 0. */
export function skyRadiance(t: SkyTables, dir: Vec3, sunAltitude: number, eyeKm: number = SKY_EYE_KM): Rgb {
  const out: Rgb = { r: 0, g: 0, b: 0 };
  radianceInto(t, dir.x, dir.y, dir.z, Math.cos(sunAltitude), Math.sin(sunAltitude), eyeKm, out);
  return out;
}

/** The sun's light at the eye, per unit irradiance above the air: exactly 0 once the ray toward it meets the ground. */
export function sunTransmittance(t: SkyTables, sunAltitude: number, eyeKm: number = SKY_EYE_KM): Rgb {
  const r = SKY_GROUND_KM + clamp(eyeKm, 0, AIR_DEPTH_KM);
  const mu = Math.sin(sunAltitude);
  if (rayToGround(r, mu) >= 0) return { r: 0, g: 0, b: 0 };
  return transmittanceAt(t, r, mu);
}

/** v in [0,1] -> elevation radians: e = sign(v - 0.5) * (PI / 2) * (2v - 1)^2. */
export function elevationOfRow(v: number): number {
  const s = 2 * v - 1;
  return (Math.PI / 2) * s * Math.abs(s);
}

/** The inverse: v = 0.5 + 0.5 * sign(e) * sqrt(|e| / (PI / 2)). */
export function rowOfElevation(e: number): number {
  return 0.5 + 0.5 * Math.sign(e) * Math.sqrt(Math.abs(e) / (Math.PI / 2));
}

/** u in [0,1] -> azimuth from the sun's, radians: PI * u. */
export function azimuthOfColumn(u: number): number {
  return Math.PI * u;
}

/**
 * Weights of the rows above the horizon in the level-ground integral, whose
 * integrand is L sin(e) cos(e) over elevation e: trapezoids between the rows'
 * elevations, with the horizon itself as a first node where the integrand is 0.
 */
const IRRADIANCE_ROW_WEIGHTS: Float64Array = (() => {
  const first = SLICE_ELEVATIONS / 2;
  const elevation = (j: number): number => (j < first ? 0 : elevationOfRow(j / (SLICE_ELEVATIONS - 1)));
  const out = new Float64Array(SLICE_ELEVATIONS);
  for (let j = first; j < SLICE_ELEVATIONS; j++) {
    const e = elevation(j);
    const below = elevation(j - 1);
    const above = j + 1 < SLICE_ELEVATIONS ? elevation(j + 1) : e;
    out[j] = ((above - below) / 2) * Math.sin(e) * Math.cos(e);
  }
  return out;
})();

/**
 * Cosine-weighted light on level ground from a slice's texels, per unit solar
 * irradiance: the rows above the horizon, each column a trapezoid in azimuth
 * over 0..PI, doubled for the mirrored half. A sky of uniform radiance 1 gives PI.
 */
export function skyIrradianceOf(texels: Float32Array): Rgb {
  const dPhi = Math.PI / (SLICE_AZIMUTHS - 1);
  let r = 0;
  let g = 0;
  let b = 0;
  for (let j = SLICE_ELEVATIONS / 2; j < SLICE_ELEVATIONS; j++) {
    const rowWeight = IRRADIANCE_ROW_WEIGHTS[j] as number;
    for (let i = 0; i < SLICE_AZIMUTHS; i++) {
      const w = rowWeight * dPhi * 2 * (i === 0 || i === SLICE_AZIMUTHS - 1 ? 0.5 : 1);
      const k = (j * SLICE_AZIMUTHS + i) * 3;
      r += (texels[k] as number) * w;
      g += (texels[k + 1] as number) * w;
      b += (texels[k + 2] as number) * w;
    }
  }
  return { r, g, b };
}

/** The whole sky for a sun at altitudeDeg, as the dome reads it. */
export function buildSlice(t: SkyTables, altitudeDeg: number): SkySlice {
  const altitude = (altitudeDeg * Math.PI) / 180;
  const sx = Math.cos(altitude);
  const sy = Math.sin(altitude);
  const px: Rgb = { r: 0, g: 0, b: 0 };
  const texels = new Float32Array(SLICE_ELEVATIONS * SLICE_AZIMUTHS * 3);
  for (let j = 0; j < SLICE_ELEVATIONS; j++) {
    const e = elevationOfRow(j / (SLICE_ELEVATIONS - 1));
    const ce = Math.cos(e);
    const se = Math.sin(e);
    for (let i = 0; i < SLICE_AZIMUTHS; i++) {
      const az = azimuthOfColumn(i / (SLICE_AZIMUTHS - 1));
      radianceInto(t, ce * Math.cos(az), se, ce * Math.sin(az), sx, sy, SKY_EYE_KM, px);
      const k = (j * SLICE_AZIMUTHS + i) * 3;
      texels[k] = px.r;
      texels[k + 1] = px.g;
      texels[k + 2] = px.b;
    }
  }
  const ring = new Float32Array(SLICE_AZIMUTHS * 3);
  const ringE = (RING_ELEVATION_DEG * Math.PI) / 180;
  for (let i = 0; i < SLICE_AZIMUTHS; i++) {
    const az = azimuthOfColumn(i / (SLICE_AZIMUTHS - 1));
    radianceInto(t, Math.cos(ringE) * Math.cos(az), Math.sin(ringE), Math.cos(ringE) * Math.sin(az), sx, sy, SKY_EYE_KM, px);
    ring[i * 3] = px.r;
    ring[i * 3 + 1] = px.g;
    ring[i * 3 + 2] = px.b;
  }
  // The zenith is the top row's first texel: exactly what the dome draws straight up.
  const top = (SLICE_ELEVATIONS - 1) * SLICE_AZIMUTHS * 3;
  const zenith: Rgb = { r: texels[top] as number, g: texels[top + 1] as number, b: texels[top + 2] as number };
  return { altitudeDeg, texels, ring, zenith, skyIrradiance: skyIrradianceOf(texels), sun: sunTransmittance(t, altitude) };
}
