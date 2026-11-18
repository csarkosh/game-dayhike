import { clamp01, type Rgb } from "./colour.js";
import type { QualityTier } from "./quality.js";
import { sunPositionAt, twilightT } from "./sky.js";
import { dreadWorldUnder, type WeatherParams } from "./weather.js";
import { gustAt, type WindRecord } from "./windParams.js";

/**
 * The pure arithmetic of the airborne motes. Babylon-free; `lite/motes.ts` binds it.
 * Species follow the sun through the same `twilightT` bands sky.ts uses, so
 * nothing new decides what time it is. Pollen by day, frost by night; the
 * midges are the lake's (`lite/midgeMeshes.ts`), not the air's everywhere.
 */

export type MoteSpecies = "pollen" | "frost";
/** The species, in the order `lite/motes.ts` builds their systems. */
export const MOTE_SPECIES: readonly MoteSpecies[] = ["pollen", "frost"];
export type MoteSettings = { rate: number; minSize: number; maxSize: number; minLife: number; maxLife: number; rise: number; jitter: number };
export type MotesRecord = { species: Record<MoteSpecies, MoteSettings>; drift: { x: number; z: number }; colour: Rgb };

export const MOTE_CAPACITY: Record<QualityTier, number> = { low: 0, medium: 600, high: 1500 };
/** Emit-rate gain on the top dread plateau. */
export const MOTE_DREAD_GAIN = 1.0;
/** Drift-speed loss on the top dread plateau: the air thickens. */
export const MOTE_DREAD_SLOW = 0.5;
/** Emit rate per particle of capacity per second at full presence: capacity/lifetime keeps the pool full. */
const RATE_PER_CAPACITY = 0.35;
/**
 * The tier's capacity is cut in thirds, a third a species, as it was when the
 * dusk's midges held one: the pollen and the frost keep their third each, at
 * the size and the rate they had, so they spend two thirds of MOTE_CAPACITY
 * between them. The midges' third is left unspent.
 */
export const MOTE_SHARES = 3;
/** Peak drift, m/s, at speed 1 on the gust crest. */
export const MOTE_WIND_DRIFT = 0.6;

/** Emitter box half-width, metres, centred on the camera; it is half as tall as it is wide. */
export const MOTE_BOX_HALF = 10;
export const MOTE_BOX_HALF_HEIGHT = MOTE_BOX_HALF * 0.5;
export const MOTE_TEX_SIZE = 16;
/** Additive alpha per mote: faint alone, bright where many overlap in lit air. */
export const MOTE_ALPHA = 0.18;

/** A soft disc: alpha 1 at the centre falling to 0 at the rim. */
export function moteDiscMap(size: number = MOTE_TEX_SIZE): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = 1 - r * r * (3 - 2 * r);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(255 * a);
    }
  }
  return data;
}

/** A species' pool on a tier: a third of the tier's capacity (500 on high, 200 on medium), none on a tier with none. */
export function moteCapacity(tier: QualityTier): number {
  return Math.ceil(MOTE_CAPACITY[tier] / MOTE_SHARES);
}

/** The emitter's box about the camera: its least corner and its greatest. */
export const MOTE_EMIT_BOX: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] } = {
  min: [-MOTE_BOX_HALF, -MOTE_BOX_HALF_HEIGHT, -MOTE_BOX_HALF],
  max: [MOTE_BOX_HALF, MOTE_BOX_HALF_HEIGHT, MOTE_BOX_HALF],
};

/**
 * The velocities a species' motes are born with under `r`: anywhere between
 * `min` and `max`, a component at a time. The wind's drift and the species'
 * rise, each way by its jitter, half of it up and down.
 */
export function moteVelocities(r: MotesRecord, name: MoteSpecies): { min: [number, number, number]; max: [number, number, number] } {
  const s = r.species[name];
  return {
    min: [r.drift.x - s.jitter, s.rise - s.jitter * 0.5, r.drift.z - s.jitter],
    max: [r.drift.x + s.jitter, s.rise + s.jitter * 0.5, r.drift.z + s.jitter],
  };
}

const BASE: Record<MoteSpecies, Omit<MoteSettings, "rate">> = {
  pollen: { minSize: 0.02, maxSize: 0.05, minLife: 4, maxLife: 8, rise: 0.08, jitter: 0.15 },
  frost: { minSize: 0.03, maxSize: 0.08, minLife: 5, maxLife: 9, rise: -0.25, jitter: 0.1 },
};

/** Horizontal drift: downwind, scaled by speed, breathing with the gust at the origin. */
export function windAt(r: WindRecord): { x: number; z: number } {
  if (r.speed === 0) return { x: 0, z: 0 };
  const g = MOTE_WIND_DRIFT * (0.4 + 0.6 * r.speed) * (0.5 + 0.5 * gustAt(r, 0, 0));
  return { x: r.dirX * g, z: r.dirZ * g };
}

/** Presence of each species in [0, 1] from the sun's altitude: the pollen by
 * day, the frost by night, neither at the middle of the twilight band. */
export function presenceAt(hour: number): Record<MoteSpecies, number> {
  const t = twilightT(sunPositionAt(hour).y);
  const horizon = twilightT(0);
  const day = clamp01((t - horizon) / (1 - horizon));
  const night = clamp01(1 - t / horizon);
  return { pollen: day, frost: night };
}

export function motesUnder(w: WeatherParams, hour: number, air: Rgb, tier: QualityTier, wind: WindRecord): MotesRecord {
  const presence = presenceAt(hour);
  const d = dreadWorldUnder(w);
  const rain = 1 - clamp01(w.rain);
  const gain = d === 0 ? 1 : 1 + MOTE_DREAD_GAIN * d;
  const slow = d === 0 ? 1 : 1 - MOTE_DREAD_SLOW * d;
  const capacity = MOTE_CAPACITY[tier];
  const species = {} as Record<MoteSpecies, MoteSettings>;
  for (const name of MOTE_SPECIES) {
    const p = presence[name] * rain * gain;
    species[name] = { ...BASE[name], rate: p === 0 ? 0 : capacity * RATE_PER_CAPACITY * p / MOTE_SHARES };
  }
  const drift = windAt(wind);
  return { species, drift: { x: drift.x * slow, z: drift.z * slow }, colour: air };
}
