/**
 * The water material's maths, Babylon-free and testable under Node, the way
 * `water.ts` and `sky.ts` are. Every constant here that the GLSL in
 * shaders/water*.fx repeats is pinned by the lockstep test in
 * waterPlugin.test.ts; tune them here and there together.
 *
 * Trigonometry and exp are fine here (renderer-only; nothing crosses the
 * wire). See docs/rendering/2026-09-29-water-material-design.md §5.
 */
import { clamp01 } from "./colour.js";
import { CLUTTER_WATER_MURK_HI, CLUTTER_WATER_MURK_LO } from "../sim/clutter.js";
import { WATER_BASE_SPACING, WATER_RING_CELLS } from "./water.js";

/** One body of water, from the world at build time (spec §7). */
export type WaterBody = {
  /** Surface height, world metres. */
  level: number;
  /** Diffuse attenuation per channel, per metre (research doc §2.3). */
  kd: [number, number, number];
  /** Deep-water colour as an albedo the sky lights. */
  lInf: [number, number, number];
  /** 0..1 scale on Cox and Munk's slope variance: 1 open sea, 0.1 a lake in old growth. */
  shelter: number;
};

export type WaterRow = Omit<WaterBody, "level">;

/** The measured rows of spec §5.2. L∞ is small: the water body itself returns
 * under 1 % in brown water and a few percent in clear or sea water. */
export const WATER_ROWS: { sea: WaterRow; lowlandLake: WaterRow; highLake: WaterRow } = {
  sea: { kd: [0.34, 0.18, 0.26], lInf: [0.02, 0.05, 0.05], shelter: 1 },
  lowlandLake: { kd: [1.1, 1.5, 3.5], lInf: [0.009, 0.006, 0.003], shelter: 0.1 },
  highLake: { kd: [0.2, 0.12, 0.2], lInf: [0.01, 0.025, 0.05], shelter: 0.3 },
};

/** Kd of the research's clear lake (§2.3, a 5.5 m Secchi depth): the row a
 * lake takes halfway between the very clear high lake and the humic one. */
export const CLEAR_LAKE_KD: [number, number, number] = [0.75, 0.8, 1.6];

function mix3(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  // a·(1 − t) + b·t, so t = 0 and t = 1 give a and b exactly.
  return [a[0]! * (1 - t) + b[0]! * t, a[1]! * (1 - t) + b[1]! * t, a[2]! * (1 - t) + b[2]! * t];
}

/**
 * A lake's water from its murk (the sim's `murkFor`): Kd through the very
 * clear, the clear and the humic rows the research measured, piecewise
 * linear; L∞ and the shelter straight from the clear high lake to the humic
 * lowland one. Murk 0 is `WATER_ROWS.highLake`, murk 1 `WATER_ROWS.lowlandLake`.
 */
export function lakeWaterRow(murk: number): WaterRow {
  const m = clamp01(murk);
  const high = WATER_ROWS.highLake;
  const low = WATER_ROWS.lowlandLake;
  const kd = m <= 0.5 ? mix3(high.kd, CLEAR_LAKE_KD, m / 0.5) : mix3(CLEAR_LAKE_KD, low.kd, (m - 0.5) / 0.5);
  return { kd, lInf: mix3(high.lInf, low.lInf, m), shelter: high.shelter * (1 - m) + low.shelter * m };
}

/** How much of a lake's surface may carry the duckweed and algae skin: none
 * up to murk 0.5, all of it from 0.8: the two numbers the clutter field
 * gates the reeds and lilies by (`CLUTTER_WATER_MURK_LO`/`_HI`). */
export function lakeSkin(murk: number): number {
  const t = clamp01((murk - CLUTTER_WATER_MURK_LO) / (CLUTTER_WATER_MURK_HI - CLUTTER_WATER_MURK_LO));
  return t * t * (3 - 2 * t);
}

/** The seed's offset (m) for the skin's noise, so two worlds' lakes do not
 * wear the same pattern. Render-only, but seeded: every peer sees one skin. */
export function waterSkinOffset(seed: number): number {
  return ((seed >>> 0) % 4096) * 0.731;
}

/** Fresnel reflectance of water at normal incidence, n = 1.33. Mirrored in shaders/water.fragment.fx. */
export const WATER_F0 = 0.02;
/** The reflected ray's least y (spec §5.1). Mirrored in shaders/water.fragment.fx. */
export const WATER_HORIZON = 0.02;
/** Metres per second the game's wind of 1 stands for (spec §5.1). */
export const WATER_WIND_MAX = 12;
/**
 * Metres per second the murky lakes' skin slides along the wind, per unit of the wind's direction: duckweed
 * pushed over the surface, its rafts keeping their shape. Mirrored in shaders/water.fragment.fx. The offset is
 * the wind's integral over the run, a few thousand metres after a day, the order of the world coordinates
 * the skin's hash already takes, so no fold is added.
 */
export const WATER_SKIN_DRIFT = 0.04;
/** Screen-space refraction offset per unit of ripple slope, in uv, at 1 m of depth. Mirrored in shaders/water.fragment.fx. */
export const WATER_REFRACT = 0.02;
/** Depth at which the refraction offset stops growing (spec §5.2). Mirrored in shaders/water.fragment.fx. */
export const WATER_REFRACT_DEPTH = 1;

/** Schlick's approximation to Fresnel reflectance; stays within 6 % absolute of the exact unpolarised curve for n = 1.33 (the worst is 0.058 at 85°). */
export function fresnelSchlick(cosTheta: number): number {
  const c = clamp01(cosTheta);
  const m = 1 - c;
  return WATER_F0 + (1 - WATER_F0) * m * m * m * m * m;
}

/** Exact unpolarised Fresnel reflectance from air into a medium of index n. */
export function fresnelExact(cosTheta: number, n = 1.33): number {
  const ci = clamp01(cosTheta);
  const si = Math.sqrt(Math.max(0, 1 - ci * ci));
  const st = si / n;
  if (st >= 1) return 1;
  const ct = Math.sqrt(1 - st * st);
  const rs = (ci - n * ct) / (ci + n * ct);
  const rp = (n * ci - ct) / (n * ci + ct);
  return 0.5 * (rs * rs + rp * rp);
}

/** e^(−2 Kd d) per channel: the bed's share of the pixel at depth d (§5.2). */
export function transmission(kd: readonly [number, number, number], depth: number): [number, number, number] {
  const d = Math.max(0, depth);
  return [Math.exp(-2 * kd[0] * d), Math.exp(-2 * kd[1] * d), Math.exp(-2 * kd[2] * d)];
}

export function meanKd(kd: readonly [number, number, number]): number {
  return (kd[0] + kd[1] + kd[2]) / 3;
}

/**
 * The medium and low tiers' single alpha: 1 − (1 − F)·e^(−2 K̄ d) (§5.2). The
 * blend scales the reflection too, so the reflected share F (Schlick on the
 * view cosine) is kept out of the transmission.
 */
export function alphaFor(kd: readonly [number, number, number], depth: number, cosTheta = 1): number {
  return 1 - (1 - fresnelSchlick(cosTheta)) * Math.exp(-2 * meanKd(kd) * Math.max(0, depth));
}

/** Cox and Munk's slope variance for a wind of U m/s: σ² = A + B·U. Mirrored in shaders/oceanShade.fragment.fx. */
export const WATER_COX_MUNK_A = 0.003;
export const WATER_COX_MUNK_B = 0.00512;

/** Cox and Munk's slope variance for a wind of `u10` m/s, the whole sea's. */
export function coxMunkVariance(u10: number): number {
  return WATER_COX_MUNK_A + WATER_COX_MUNK_B * u10;
}

/** Cox and Munk's slope variance, σ² = 0.003 + 0.00512 U, scaled by the body's shelter (§5.1). */
export function slopeVariance(wind01: number, shelter: number): number {
  const u = clamp01(wind01) * WATER_WIND_MAX;
  return coxMunkVariance(u) * clamp01(shelter);
}

/** PBR perceptual roughness from the slope variance: Beckmann α = √(2σ²), roughness = √α. */
export function roughnessFor(wind01: number, shelter: number): number {
  const alpha = Math.sqrt(2 * slopeVariance(wind01, shelter));
  return Math.sqrt(alpha);
}

/**
 * The sea's roughness from the slope variance its normal leaves undrawn, per pixel in the shader (the
 * roughness line `waterPlugin.ts` rewrites): √√(2σ²) as `roughnessFor`, at most 1.
 */
export function roughnessFromVariance(variance: number): number {
  return Math.min(Math.sqrt(Math.sqrt(2 * Math.max(0, variance))), 1);
}

/**
 * The least slope variance the sea's roughness keeps however much of Cox and Munk's the drawn waves carry:
 * half their calm intercept, so a glassy sea's glint stays wider than a pixel. Mirrored in
 * shaders/oceanShade.fragment.fx.
 */
export const OCEAN_SLOPE_VAR_FLOOR = 0.0015;

/**
 * The slope variance left to the sea's roughness (spec §7.3): Cox and Munk's for the wind sea's wind
 * `u10` (m/s), scaled by the shelter, less `drawn`, the variance the drawn waves already put in the
 * normal; never under OCEAN_SLOPE_VAR_FLOOR. `oceanUndrawnVariance` in shaders/oceanShade.fragment.fx.
 */
export function undrawnSlopeVariance(u10: number, shelter: number, drawn: number): number {
  return Math.max(coxMunkVariance(u10) * shelter - drawn, OCEAN_SLOPE_VAR_FLOOR);
}

/**
 * A drawn wave keeps all of its share while its phase turns by at most a quarter turn over one step of the
 * drawing (a pixel, or a ring's cells): four steps a wavelength; none from a half turn, two steps, where it
 * would alias. Mirrored in shaders/oceanSurface.fx.
 */
export const OCEAN_RESOLVE_PHASE_LO = Math.PI / 2;
export const OCEAN_RESOLVE_PHASE_HI = Math.PI;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The share of a wave the drawing keeps when its phase turns by `turn` radians over one step. */
export function resolvedShare(turn: number): number {
  return 1 - smoothstep(OCEAN_RESOLVE_PHASE_LO, OCEAN_RESOLVE_PHASE_HI, turn);
}

/**
 * The slope variance the drawn waves carry when each is drawn over steps of `step` metres along its own
 * direction: Σ ½(a·k·share)², a sinusoid of amplitude a and wavenumber k carrying ½(a·k)², faded by
 * `resolvedShare(k·step)`. With a step of 0 it is the waves' whole variance.
 */
export function resolvedSlopeVariance(waves: readonly { amplitude: number; k: number }[], step: number): number {
  let sum = 0;
  for (const { amplitude, k } of waves) {
    const a = amplitude * resolvedShare(k * step);
    sum += 0.5 * (a * k) * (a * k);
  }
  return sum;
}

/**
 * The spacing (m) of the ring that draws a point (dx, dz) from the eye, as the vertex shader estimates it
 * (`oceanRingCell`): a ring of spacing s lies from OCEAN_RING_REACH·s to twice that from the eye, so the
 * estimate is the ring's own spacing at its inner edge and the next ring's at its outer, never under the
 * finest ring's. It depends on the point alone, so two rings drawing one point displace it alike.
 */
export const OCEAN_RING_REACH = WATER_RING_CELLS / 4;
export function oceanRingCell(dx: number, dz: number): number {
  return Math.max(WATER_BASE_SPACING, Math.max(Math.abs(dx), Math.abs(dz)) / OCEAN_RING_REACH);
}

/**
 * Tilts a ripple normal so the reflected ray clears WATER_HORIZON: the
 * reflection r is lifted to y = WATER_HORIZON (its xz shortened to keep it
 * unit), and the normal that reflects `view` exactly onto that ray is the
 * half-vector normalize(view + r). One step, no iteration; mirrors
 * waterHorizonNormal in shaders/water.fragment.fx exactly. `view` points
 * from the surface to the eye, above the water.
 */
export function horizonSafeNormal(
  n: readonly [number, number, number],
  view: readonly [number, number, number],
): [number, number, number] {
  const d = -(view[0] * n[0] + view[1] * n[1] + view[2] * n[2]);
  let rx = -view[0] - 2 * d * n[0];
  let ry = -view[1] - 2 * d * n[1];
  let rz = -view[2] - 2 * d * n[2];
  if (ry >= WATER_HORIZON) return [n[0], n[1], n[2]];
  const h = WATER_HORIZON;
  const xz = Math.hypot(rx, rz);
  if (xz < 1e-4) {
    rx = 0; ry = 1; rz = 0;
  } else {
    const s = Math.sqrt(1 - h * h) / xz;
    rx *= s; rz *= s; ry = h;
  }
  const hx = view[0] + rx, hy = view[1] + ry, hz = view[2] + rz;
  const len = Math.hypot(hx, hy, hz);
  return [hx / len, hy / len, hz / len];
}
