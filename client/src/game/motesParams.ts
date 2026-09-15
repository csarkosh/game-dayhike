import { clamp01, type Rgb } from "./colour.js";
import type { QualityTier } from "./quality.js";
import { sunPositionAt, twilightT } from "./sky.js";
import { dreadWorldUnder, type WeatherParams } from "./weather.js";
import { WIND_OMEGA_GUST, WIND_OMEGA_GUST2 } from "./windField.js";

/**
 * The pure arithmetic of the airborne motes. Babylon-free; `motes.ts` binds it.
 * Species follow the sun through the same `twilightT` bands sky.ts uses, so
 * nothing new decides what time it is.
 */

export type MoteSpecies = "pollen" | "midge" | "frost";
export type MoteSettings = { rate: number; minSize: number; maxSize: number; minLife: number; maxLife: number; rise: number; jitter: number };
export type MotesRecord = { species: Record<MoteSpecies, MoteSettings>; drift: { x: number; z: number }; colour: Rgb };

export const MOTE_CAPACITY: Record<QualityTier, number> = { low: 0, medium: 600, high: 1500 };
/** Emit-rate gain on the top dread plateau. */
export const MOTE_DREAD_GAIN = 1.0;
/** Drift-speed loss on the top dread plateau: the air thickens. */
export const MOTE_DREAD_SLOW = 0.5;
/** Emit rate per particle of capacity per second at full presence: capacity/lifetime keeps the pool full. */
const RATE_PER_CAPACITY = 0.35;
/** Peak wind drift, m/s, at the gust crest. */
const WIND_DRIFT = 0.6;

const BASE: Record<MoteSpecies, Omit<MoteSettings, "rate">> = {
  pollen: { minSize: 0.02, maxSize: 0.05, minLife: 4, maxLife: 8, rise: 0.08, jitter: 0.15 },
  midge: { minSize: 0.01, maxSize: 0.02, minLife: 1.5, maxLife: 3, rise: 0.0, jitter: 0.9 },
  frost: { minSize: 0.03, maxSize: 0.08, minLife: 5, maxLife: 9, rise: -0.25, jitter: 0.1 },
};

/** The two gust terms windPlugin.ts sums, evaluated at the origin, as a horizontal drift. */
export function windAt(t: number): { x: number; z: number } {
  const gust = Math.sin(t * WIND_OMEGA_GUST) + 0.6 * Math.sin(t * WIND_OMEGA_GUST2);
  return { x: WIND_DRIFT * 0.75 * gust, z: WIND_DRIFT * 0.35 * gust };
}

/** Presence of each species in [0, 1] from the sun's altitude: day, the twilight band, night. */
export function presenceAt(hour: number): Record<MoteSpecies, number> {
  const t = twilightT(sunPositionAt(hour).y);
  const horizon = twilightT(0);
  const day = clamp01((t - horizon) / (1 - horizon));
  const night = clamp01(1 - t / horizon);
  const dusk = clamp01(1 - day - night);
  return { pollen: day, midge: dusk, frost: night };
}

export function motesUnder(w: WeatherParams, hour: number, air: Rgb, tier: QualityTier, t: number): MotesRecord {
  const presence = presenceAt(hour);
  const d = dreadWorldUnder(w);
  const rain = 1 - clamp01(w.rain);
  const gain = d === 0 ? 1 : 1 + MOTE_DREAD_GAIN * d;
  const slow = d === 0 ? 1 : 1 - MOTE_DREAD_SLOW * d;
  const capacity = MOTE_CAPACITY[tier];
  const species = {} as Record<MoteSpecies, MoteSettings>;
  for (const name of ["pollen", "midge", "frost"] as const) {
    const p = presence[name] * rain * gain;
    species[name] = { ...BASE[name], rate: p === 0 ? 0 : capacity * RATE_PER_CAPACITY * p / 3 };
  }
  const wind = windAt(t);
  return { species, drift: { x: wind.x * slow, z: wind.z * slow }, colour: air };
}
