/**
 * The physics of a wave coming in from the open sea, Babylon-free and tested
 * under Node: linear dispersion, group speed, shoaling, refraction on a coast
 * whose depth depends on the distance to shore alone, Weggel's breaker index
 * and Callaghan's whitecap coverage. The tables the sea's shaders read are
 * built from these on the CPU (`oceanTables.ts`); nothing here runs per pixel.
 *
 * Render-side only: nothing here crosses the wire or reaches `sim/`, so
 * `Math.tanh`, `Math.exp` and `Math.pow` are fine.
 * See docs/rendering/2026-10-02-ocean-waves-design.md §4.
 */

/** Gravity, m/s². */
export const OCEAN_G = 9.81;
/** Weggel's breaker index is held inside [MIN, MAX]: 0.78 is the flat-bed value, 1.56 twice it. */
export const WEGGEL_GAMMA_MIN = 0.78;
export const WEGGEL_GAMMA_MAX = 1.56;
/** Weggel's fit holds for bed slopes up to 1:10; steeper slopes are taken as 1:10. */
export const WEGGEL_SLOPE_MAX = 0.1;
/** Wind speed (U10, m/s) below which no whitecap forms. */
export const CALLAGHAN_ONSET = 3.7;
/** The upper end of Callaghan's cubic fit (m/s); past it the cubic goes on along its tangent. */
export const CALLAGHAN_TOP = 11.25;
/** Callaghan's coefficient as a fraction (3.18e-3 per cent): coverage = coeff × (U − onset)³. */
export const CALLAGHAN_COEFF = 3.18e-5;
/** The most of the sea whitecaps cover. */
export const WHITECAP_MAX = 0.1;

/** The shallowest depth the dispersion is solved at (m); shallower depths are taken as this. */
const DEPTH_MIN = 0.01;
/** k·h past which tanh(k·h) is 1 to double precision: deep water. */
const DEEP_KH = 20;

/** f(k) = g·k·tanh(k·h) − ω² and its derivative, for one Newton step at depth h. */
function newtonStep(omega: number, depth: number, k: number): number {
  const t = Math.tanh(k * depth);
  const f = OCEAN_G * k * t - omega * omega;
  const df = OCEAN_G * t + OCEAN_G * k * depth * (1 - t * t);
  return k - f / df;
}

/**
 * The wavenumber (rad/m) of angular frequency ω (rad/s) at depth h (m), from
 * ω² = g k tanh(k h): Fenton and McKee's explicit form,
 * k = k₀ / tanh((k₀ h)^¾)^⅔ with k₀ = ω²/g (within 1.7 % everywhere), then
 * two Newton steps. One step leaves up to 8.5e-5 (a 13.8 s wave in 12.6 m);
 * the second brings every period from 3 to 16 s at every depth to within
 * 1e-8 of the exact root. Depths below 0.01 m are taken as 0.01 m; an infinite
 * depth (or k₀·h past 20) is deep water, k = k₀.
 */
export function waveNumber(omega: number, depth: number): number {
  const k0 = (omega * omega) / OCEAN_G;
  if (depth === Infinity || k0 * depth > DEEP_KH) return k0;
  const h = Math.max(depth, DEPTH_MIN);
  let k = k0 / Math.pow(Math.tanh(Math.pow(k0 * h, 0.75)), 2 / 3);
  k = newtonStep(omega, h, k);
  k = newtonStep(omega, h, k);
  return k;
}

/**
 * The reference root of ω² = g k tanh(k h), Newton's method run to
 * convergence from Eckart's start k₀ / √tanh(k₀ h). For the tests; the sea
 * uses `waveNumber`.
 */
export function waveNumberNewton(omega: number, depth: number): number {
  const k0 = (omega * omega) / OCEAN_G;
  if (depth === Infinity) return k0;
  const h = Math.max(depth, DEPTH_MIN);
  let k = k0 / Math.sqrt(Math.tanh(k0 * h));
  for (let i = 0; i < 100; i++) {
    const next = newtonStep(omega, h, k);
    const done = Math.abs(next - k) <= 1e-15 * next;
    k = next;
    if (done) break;
  }
  return k;
}

/** Group speed (m/s): (ω/k)·½(1 + 2kh / sinh 2kh); ω/(2k) in deep water. */
export function groupSpeed(omega: number, k: number, depth: number): number {
  const kh = k * Math.max(depth, DEPTH_MIN);
  const n = depth === Infinity || kh > DEEP_KH ? 0.5 : 0.5 * (1 + (2 * kh) / Math.sinh(2 * kh));
  return (omega / k) * n;
}

/**
 * The shoaling coefficient K_s = √(c_g,deep / c_g(h)) (H² c_g conserved): it
 * dips to about 0.91 at intermediate depth, then grows toward the shore.
 */
export function shoalingFactor(omega: number, depth: number): number {
  const deep = OCEAN_G / (2 * omega);
  return Math.sqrt(deep / groupSpeed(omega, waveNumber(omega, depth), depth));
}

/**
 * Snell's law on a coast running along z: a component keeps its along-shore
 * wavenumber k0z, so at local wavenumber k its onshore wavenumber is
 * kn = √(k² − k0z²), and the crests' spreading gives the refraction
 * coefficient K_r = √(cos θ₀ / cos θ), with cos θ₀ = √(k0² − k0z²)/k0 and
 * cos θ = kn/k. `k0` is the offshore wavenumber's magnitude.
 */
export function refraction(k0: number, k0z: number, k: number): { kn: number; kr: number } {
  const kn = Math.sqrt(Math.max(k * k - k0z * k0z, 0));
  const cos0 = Math.sqrt(Math.max(k0 * k0 - k0z * k0z, 0)) / k0;
  const cos = kn / k;
  return { kn, kr: cos > 0 ? Math.sqrt(cos0 / cos) : 1 };
}

/**
 * Weggel's coefficients for a bed slope tan β (taken as at most
 * WEGGEL_SLOPE_MAX): a = 43.8 (1 − e^(−19 tan β)), b = 1.56 / (1 + e^(−19.5 tan β)).
 */
export function weggelCoefficients(slope: number): { a: number; b: number } {
  const s = Math.min(Math.abs(slope), WEGGEL_SLOPE_MAX);
  return { a: 43.8 * (1 - Math.exp(-19 * s)), b: 1.56 / (1 + Math.exp(-19.5 * s)) };
}

/**
 * Weggel's breaker index γ_b = b − a·H/(g T²) for a wave of local height H (m)
 * and period T (s) on a bed of slope tan β, held inside
 * [WEGGEL_GAMMA_MIN, WEGGEL_GAMMA_MAX]: about 0.9 for the typical swell on a
 * 1:50 bed, about 1.24 on a 1:12 face. The wave breaks where H > γ_b h.
 */
export function breakerIndex(slope: number, height: number, period: number): number {
  const { a, b } = weggelCoefficients(slope);
  const gamma = b - (a * height) / (OCEAN_G * period * period);
  return Math.min(WEGGEL_GAMMA_MAX, Math.max(WEGGEL_GAMMA_MIN, gamma));
}

/**
 * The fraction of the sea whitecaps cover at wind speed U10 (m/s), from
 * Callaghan's fit 3.18e-3 (U − 3.7)³ per cent: none at 3.7 m/s and below,
 * 0.11 % at 7 m/s, 0.8 % at 10. Past the fit's upper end (CALLAGHAN_TOP) the
 * cubic goes on along its tangent there (3.4 % at 15 m/s, inside the 2 to 4 %
 * observed), and the whole is capped at WHITECAP_MAX.
 */
export function whitecapCoverage(u10: number): number {
  if (!(u10 > CALLAGHAN_ONSET)) return 0;
  const top = CALLAGHAN_TOP - CALLAGHAN_ONSET;
  const x = u10 - CALLAGHAN_ONSET;
  const cover =
    x <= top ? CALLAGHAN_COEFF * x * x * x : CALLAGHAN_COEFF * top * top * (top + 3 * (x - top));
  return Math.min(WHITECAP_MAX, cover);
}
