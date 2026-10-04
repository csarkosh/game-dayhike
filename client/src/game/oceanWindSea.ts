/**
 * The wind sea's state, and the clock the sea keeps. Babylon-free (on
 * BABYLON_FREE_FILES) and render-side: every input is something each client
 * already computes from shared state (the weather, the hour, the tick), so
 * nothing new crosses the network.
 *
 * The wind sea is a fully developed spectrum for U₁₀ = the game's wind speed ×
 * WIND_SEA_U_PER_WIND × the hour's factor (glassy at dawn, a sea breeze in the
 * afternoon): Hs ≈ 0.28 U²/g, fp ≈ 0.123 g/U. Blowing off the land its height
 * is held to the fetch law's share of that, which is nothing at the waterline
 * and grows with the distance out. Whitecaps cover Callaghan's fraction.
 *
 * Convention: the sea lies toward −x and the land toward +x, so a wind blowing
 * toward +x (dir.x > 0) blows onshore.
 */
import { TICK_DT } from "../sim/constants.js";
import { OCEAN_G, whitecapCoverage } from "./oceanPhysics.js";
import { WIND_SEA_FP_COEFF, WIND_SEA_HS_COEFF } from "./oceanSpectrum.js";

/** The spectrum's own constants, defined beside it (`windSeaH0` reads them) and
 * importable from here too: Hs ≈ WIND_SEA_HS_COEFF·U²/g and fp ≈
 * WIND_SEA_FP_COEFF·g/U fully developed, its spreading s and its γ. */
export { WIND_SEA_HS_COEFF, WIND_SEA_FP_COEFF, WIND_SEA_SPREAD, WIND_SEA_GAMMA } from "./oceanSpectrum.js";

/** m/s of U₁₀ per unit of the game's 0..1 wind speed, as `roughnessFor` reads it. */
export const WIND_SEA_U_PER_WIND = 12;
/** The hour's factor on the wind: the dawn calm and the afternoon's sea breeze. */
export const WIND_SEA_DAWN = 0.4;
export const WIND_SEA_AFTERNOON = 1.25;
/** The hours (h) each holds fully, and the width (h) of the shoulder either side. */
export const WIND_SEA_DAWN_HOURS: readonly [number, number] = [5, 8];
export const WIND_SEA_AFTERNOON_HOURS: readonly [number, number] = [13, 18];
export const WIND_SEA_SHOULDER = 1;
/** The fetch law's coefficient (the Coastal Engineering Manual's): over a fetch X
 * the wind sea's height is Hs = WIND_SEA_FETCH_COEFF·√(gX/U²)·U²/g. */
export const WIND_SEA_FETCH_COEFF = 0.0016;
/** The wind (m/s) the medium tier's loop is computed at. */
export const WIND_SEA_U_REF = 10;
/** The least wind (m/s) the period and the loop's rate are taken at, so a still sea's stay finite. */
export const WIND_SEA_U_FLOOR = 0.5;
/** The time (s) by which the wind sea follows its wind's speed, a first-order lag: a sea state lags its wind by
 * minutes, so a 3 s weather fade no longer rebuilds the spectrum a dozen times or sweeps the loop's tile. */
export const OCEAN_SEA_LAG = 60;

export type WindSeaState = {
  u10: number; dir: [number, number];
  /** The fully developed height (m): the fetch's share of it is `windSeaShare`'s. */
  hs: number;
  tp: number;
  /** The wind's component toward the land: dir.x, the land lying toward +x. */
  onshore: number;
  /** 0 for a wind straight off the land, 1 onshore, a smoothstep between. */
  onshoreWeight: number;
  /** whitecapCoverage(u10). */
  coverage: number;
  /** (u10 / WIND_SEA_U_REF)²: the medium loop's lengths and heights. */
  loopScale: number;
  /** WIND_SEA_U_REF / u10, u10 floored at WIND_SEA_U_FLOOR: the loop's time rate. */
  loopRate: number;
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 1 inside [from, to], 0 a shoulder's width outside it, smoothstep between. */
function held(hour: number, [from, to]: readonly [number, number]): number {
  return smoothstep(from - WIND_SEA_SHOULDER, from, hour) * (1 - smoothstep(to, to + WIND_SEA_SHOULDER, hour));
}

/** The hour's factor on the wind: WIND_SEA_DAWN through dawn, WIND_SEA_AFTERNOON through the afternoon, 1 otherwise. */
export function hourFactor(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  return (
    1 +
    (WIND_SEA_DAWN - 1) * held(h, WIND_SEA_DAWN_HOURS) +
    (WIND_SEA_AFTERNOON - 1) * held(h, WIND_SEA_AFTERNOON_HOURS)
  );
}

/** The wind sea for the game's wind (0..1, and the direction it blows toward) at an hour. */
export function windSeaStateFor(wind01: number, dir: [number, number], hour: number): WindSeaState {
  const u10 = Math.max(0, wind01) * WIND_SEA_U_PER_WIND * hourFactor(hour);
  const len = Math.hypot(dir[0], dir[1]);
  const unit: [number, number] = len > 0 ? [dir[0] / len, dir[1] / len] : [1, 0];
  const onshore = unit[0];
  return windSeaAtSpeed({ dir: unit, onshore, onshoreWeight: smoothstep(-0.2, 0.3, onshore) }, u10);
}

/** The wind sea blowing as `heading` does (its direction and onshore weight) at a wind of u10 (m/s): the
 * height, period, whitecaps and the loop's scale and rate the speed gives. */
export function windSeaAtSpeed(heading: Pick<WindSeaState, "dir" | "onshore" | "onshoreWeight">, u10: number): WindSeaState {
  const floored = Math.max(u10, WIND_SEA_U_FLOOR);
  return {
    u10,
    dir: heading.dir,
    hs: (WIND_SEA_HS_COEFF * u10 * u10) / OCEAN_G,
    tp: floored / (WIND_SEA_FP_COEFF * OCEAN_G),
    onshore: heading.onshore,
    onshoreWeight: heading.onshoreWeight,
    coverage: whitecapCoverage(u10),
    loopScale: (u10 / WIND_SEA_U_REF) * (u10 / WIND_SEA_U_REF),
    loopRate: WIND_SEA_U_REF / floored,
  };
}

/** The wind speed the sea follows (m/s), `lagged`, a frame of `dt` seconds on: moved toward the wind's own
 * u10 by the first-order lag OCEAN_SEA_LAG. A step back of the seconds (dt below 0) moves it not at all. */
export function lagSeaWind(lagged: number, u10: number, dt: number): number {
  return lagged + (u10 - lagged) * (1 - Math.exp(-Math.max(dt, 0) / OCEAN_SEA_LAG));
}

/**
 * The fetch-limited height over the fully developed one, for a wind of u10 (m/s)
 * blowing over `fetch` (m) of water: 0 at the waterline and on land, 1 once the
 * sea is fully developed. At 8 m/s it leaves 3 cm over 50 m and 12 cm over 1 km.
 */
export function fetchShare(u10: number, fetch: number): number {
  return Math.min(
    1,
    ((WIND_SEA_FETCH_COEFF / WIND_SEA_HS_COEFF) * Math.sqrt(OCEAN_G * Math.max(fetch, 0))) /
      Math.max(u10, WIND_SEA_U_FLOOR),
  );
}

/**
 * The share of the wind sea's fully developed height at a point
 * `coastDistance` (m) from the coastline, negative at sea: the fetch's share
 * under a wind off the land, mixed toward 1 by how onshore the wind blows.
 */
export function windSeaShare(state: WindSeaState, coastDistance: number): number {
  const share = fetchShare(state.u10, -coastDistance);
  return share + (1 - share) * state.onshoreWeight;
}

/**
 * The sea's seconds: the simulation's tick and the frame's fraction of the
 * next, `alpha` (the fixed-step accumulator's leftover over TICK_DT, 0 to 1,
 * clamped there). The tick advances as the leftover wraps, so the sum runs on
 * without a break from frame to frame; every peer's tick is the host's to
 * within its prediction lead. A client's tick reconciled to the host's can
 * step it back a few ticks, so a consumer that keeps state from frame to frame
 * (the wind sea's clocks and its lag, the water's wind drift) holds its step at
 * no less than zero and runs on only once the seconds pass the latest it
 * counted.
 */
export function sharedSeconds(tick: number, alpha: number): number {
  return (tick + Math.min(1, Math.max(0, alpha))) * TICK_DT;
}
