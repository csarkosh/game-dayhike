/**
 * The surf's spray as it is drawn, with no engine: on the high tier, a short
 * burst of soft sprites at each plunge on the cove's face, thrown shoreward
 * and up at the lip's speed, pulled down by gravity, slowed by drag and
 * carried by the wind, each living one to two seconds and fading out.
 *
 * One unit quad a sprite, SURF_SPRAY_BURSTS slots of SURF_SPRAY_PER_BURST
 * made once, each with a static seed and its slot, placed every frame by the
 * vertex stage from its slot's record. `burst` claims the slot started
 * longest ago (one never started first) and writes its origin, its direction
 * and its speed, and keeps its start; `age` writes each slot's age, so the
 * GPU never sees the shared seconds' large values, only an age of a few
 * seconds. A slot never started holds an age past every life and draws
 * nothing; with no slot alive nothing is drawn.
 *
 * A sprite's path is the closed form of a throw under gravity with linear
 * drag toward the wind's velocity, v' = −c(v − w) − g ŷ: p(t) = p0 + w′t +
 * (v0 − w′)(1 − e^(−ct))/c, with w′ = w − (g/c) ŷ. `sprayPointAt` is the
 * vertex stage's twin, constant for constant (the lockstep test holds them).
 * The wind's velocity is the wind record's direction at its speed times
 * WIND_SEA_U_PER_WIND, the sea's own reading of the game's wind. The colour
 * is the foam's white (OCEAN_FOAM_ALBEDO) under the sun and the fill.
 *
 * Which plunges throw spray (`createSprayThrow`): this frame's, within
 * SURF_SPRAY_RANGE_M of the camera, nearest first.
 *
 * Whoever draws the spray (`surfSpray.ts` on Babylon.js) reads these.
 */
import { LIP_SPEED_MAX, LIP_SPEED_MIN, type LipTracker } from "./oceanBreaker.js";
import { WIND_SEA_U_PER_WIND } from "./oceanWindSea.js";
import { SWASH_G } from "./swashRunUp.js";
import type { SwashCove } from "./swashTable.js";
import { OCEAN_FOAM_ALBEDO } from "./waterShading.js";
import type { WindRecord } from "./windParams.js";

/** Sprites a burst. */
export const SURF_SPRAY_PER_BURST = 60;
/** Burst slots: at most this many bursts live at once. */
export const SURF_SPRAY_BURSTS = 6;
/** A sprite's life (s), from the first to the second by its seed. */
export const SURF_SPRAY_LIFE_S: readonly [number, number] = [1, 2];
/** Linear drag toward the wind's velocity (1/s). */
export const SURF_SPRAY_DRAG = 1.5;
/** A sprite's full width (m), at the end of its life; half that at its start. */
export const SURF_SPRAY_SIZE_M = 0.6;
/** Gravity (m/s²). */
export const SURF_SPRAY_G = 9.81;
/** The stretch (m) across the throw a burst's sprites start along: a plunge's (`LIP_STRETCH_M`). */
export const SURF_SPRAY_STRETCH_M = 20;
/** The throw's elevation above level (rad), from the first to the second by a sprite's seed. */
export const SURF_SPRAY_ELEVATION: readonly [number, number] = [0.35, 1.2];
/** The least share of a burst's speed a sprite is thrown at; the most is all of it. */
export const SURF_SPRAY_SPEED_MIN = 0.5;
/** A sprite's cover at its centre while fresh. */
export const SURF_SPRAY_OPACITY = 0.5;
/** Plunges farther than this (m) from the eye throw no spray. */
export const SURF_SPRAY_RANGE_M = 300;

/** The seed buffer's hash seed: the sprites' layout is the same on every load. */
export const SURF_SPRAY_SEED = 0x53707279;
/** The age written into a slot never started: past every life. */
export const SURF_SPRAY_NEVER_AGE = SURF_SPRAY_LIFE_S[1] + 1;
/** Floats a slot: (x, y, z, age), (dirX, dirZ, speed, 0). */
export const SURF_SPRAY_SLOT_FLOATS = 8;
/** The mean of the lip's throw over the wave's speed (`LIP_SPEED_MIN`..`LIP_SPEED_MAX`): the spray's launch. */
export const SURF_SPRAY_THROW = (LIP_SPEED_MIN + LIP_SPEED_MAX) / 2;

const finite = (v: number): boolean => Number.isFinite(v);

/**
 * `count` seeds of four hashes in [0, 1) each, from an integer hash of the
 * index and `seed` (Wang's 32-bit mix, integer arithmetic only, as
 * `rainSeeds`): the same on every load.
 */
export function spraySeeds(count: number, seed: number): Float32Array {
  const out = new Float32Array(count * 4);
  const mix = (v: number): number => {
    let x = v >>> 0;
    x = (x ^ 61) ^ (x >>> 16);
    x = Math.imul(x, 9) >>> 0;
    x = x ^ (x >>> 4);
    x = Math.imul(x, 0x27d4eb2d) >>> 0;
    x = x ^ (x >>> 15);
    return x >>> 0;
  };
  let h = mix(seed >>> 0);
  for (let i = 0; i < count * 4; i++) {
    h = mix(h + 0x9e3779b9);
    out[i] = (h >>> 8) / 16777216;
  }
  return out;
}

/** The slot each of `count` sprites belongs to: SURF_SPRAY_PER_BURST to a slot, in order. */
export function spraySlots(count: number): Float32Array {
  const slots = new Float32Array(count);
  for (let i = 0; i < count; i++) slots[i] = Math.floor(i / SURF_SPRAY_PER_BURST);
  return slots;
}

/** A burst slot as the vertex stage reads it. */
export type SprayBurst = { x: number; y: number; z: number; age: number; dirX: number; dirZ: number; speed: number };
/** A sprite's centre, its alpha and its width (m). */
export type SprayPoint = { x: number; y: number; z: number; alpha: number; size: number };

/**
 * The vertex stage's `sprayPlace` at the quad's centre, in TypeScript: the
 * sprite of `seed` (four hashes) in `burst`, under a wind of (`windX`,
 * `windZ`) m/s, into `out`.
 */
export function sprayPointAt(
  burst: SprayBurst, seed: ArrayLike<number>, windX: number, windZ: number, out: SprayPoint,
): SprayPoint {
  const h0 = seed[0] as number;
  const h1 = seed[1] as number;
  const h2 = seed[2] as number;
  const h3 = seed[3] as number;
  const life = SURF_SPRAY_LIFE_S[0] + (SURF_SPRAY_LIFE_S[1] - SURF_SPRAY_LIFE_S[0]) * h3;
  const alive = burst.age >= 0 && burst.age < life ? 1 : 0;
  const t = Math.min(Math.max(burst.age, 0), life);
  const along = (h0 - 0.5) * SURF_SPRAY_STRETCH_M;
  const elevation = SURF_SPRAY_ELEVATION[0] + (SURF_SPRAY_ELEVATION[1] - SURF_SPRAY_ELEVATION[0]) * h1;
  const speed = burst.speed * (SURF_SPRAY_SPEED_MIN + (1 - SURF_SPRAY_SPEED_MIN) * h2);
  const vx = burst.dirX * Math.cos(elevation) * speed;
  const vy = Math.sin(elevation) * speed;
  const vz = burst.dirZ * Math.cos(elevation) * speed;
  const fall = -SURF_SPRAY_G / SURF_SPRAY_DRAG;
  const k = (1 - Math.exp(-SURF_SPRAY_DRAG * t)) / SURF_SPRAY_DRAG;
  out.x = burst.x - burst.dirZ * along + windX * t + (vx - windX) * k;
  out.y = burst.y + fall * t + (vy - fall) * k;
  out.z = burst.z + burst.dirX * along + windZ * t + (vz - windZ) * k;
  const lived = t / life;
  out.alpha = (1 - lived) * alive;
  out.size = SURF_SPRAY_SIZE_M * (0.5 + 0.5 * lived) * alive;
  return out;
}

/** The burst slots, kept and aged. */
export type SprayBursts = {
  /** The slots, SURF_SPRAY_SLOT_FLOATS floats each: (x, y, z, age), (dirX, dirZ, speed, 0). Written in place. */
  readonly data: Float32Array;
  /** A burst at (`x`, `y`, `z`) thrown along the level direction (`dirX`,
   * `dirZ`) at `speed` (m/s), starting at the shared `seconds`: it takes the
   * slot started longest ago. A burst with a value that is not a finite
   * number is not made. */
  burst(x: number, y: number, z: number, dirX: number, dirZ: number, speed: number, seconds: number): void;
  /** Each slot's age at the shared `seconds`, written into `data`. Returns whether a slot is alive. */
  age(seconds: number): boolean;
};

/** The spray's burst slots, none started, kept in `bursts` (an array of their size; one is made when none is handed). */
export function createSprayBursts(bursts: Float32Array = new Float32Array(SURF_SPRAY_BURSTS * SURF_SPRAY_SLOT_FLOATS)): SprayBursts {
  if (bursts.length !== SURF_SPRAY_BURSTS * SURF_SPRAY_SLOT_FLOATS) throw new Error("the spray's slots are not the size its stage reads");
  const starts = new Float64Array(SURF_SPRAY_BURSTS).fill(Number.NEGATIVE_INFINITY);
  for (let s = 0; s < SURF_SPRAY_BURSTS; s++) bursts[s * SURF_SPRAY_SLOT_FLOATS + 3] = SURF_SPRAY_NEVER_AGE;
  return {
    data: bursts,
    burst(x, y, z, dirX, dirZ, speed, seconds) {
      if (!finite(x) || !finite(y) || !finite(z) || !finite(dirX) || !finite(dirZ) || !finite(speed) || !finite(seconds)) return;
      let slot = 0;
      for (let s = 1; s < SURF_SPRAY_BURSTS; s++) if ((starts[s] as number) < (starts[slot] as number)) slot = s;
      const len = Math.hypot(dirX, dirZ);
      const at = slot * SURF_SPRAY_SLOT_FLOATS;
      starts[slot] = seconds;
      bursts[at] = x;
      bursts[at + 1] = y;
      bursts[at + 2] = z;
      bursts[at + 3] = 0;
      bursts[at + 4] = len > 0 ? dirX / len : 1;
      bursts[at + 5] = len > 0 ? dirZ / len : 0;
      bursts[at + 6] = Math.max(0, speed);
      bursts[at + 7] = 0;
    },
    age(seconds) {
      let alive = false;
      for (let s = 0; s < SURF_SPRAY_BURSTS; s++) {
        const start = starts[s] as number;
        const age = Number.isFinite(start) && Number.isFinite(seconds) ? seconds - start : SURF_SPRAY_NEVER_AGE;
        bursts[s * SURF_SPRAY_SLOT_FLOATS + 3] = age;
        if (age >= 0 && age < SURF_SPRAY_LIFE_S[1]) alive = true;
      }
      return alive;
    },
  };
}

/** The wind's level velocity (m/s) as the spray is carried by it, into `out`: the record's direction at the sea's reading of its speed. */
export function sprayWind(wind: WindRecord, out: [number, number]): [number, number] {
  const speed = Number.isFinite(wind.speed) ? Math.min(Math.max(wind.speed, 0), 1) * WIND_SEA_U_PER_WIND : 0;
  out[0] = Number.isFinite(wind.dirX) ? wind.dirX * speed : 0;
  out[1] = Number.isFinite(wind.dirZ) ? wind.dirZ * speed : 0;
  return out;
}

/** A light as the spray takes its colour from it: its colour and its intensity. */
export type SprayLight = { r: number; g: number; b: number; intensity: number };

/** The spray's colour under `lights`, into `out`: the foam's white under their sum. */
export function sprayColour(lights: readonly SprayLight[], out: [number, number, number]): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const light of lights) {
    r += light.r * light.intensity;
    g += light.g * light.intensity;
    b += light.b * light.intensity;
  }
  out[0] = OCEAN_FOAM_ALBEDO * r;
  out[1] = OCEAN_FOAM_ALBEDO * g;
  out[2] = OCEAN_FOAM_ALBEDO * b;
  return out;
}

/** What throws a burst: `SprayBursts.burst`, or whoever stands in for it. */
export type SprayThrown = (x: number, y: number, z: number, dirX: number, dirZ: number, speed: number, seconds: number) => void;

/**
 * Spray for a frame's plunges within SURF_SPRAY_RANGE_M of the camera,
 * nearest first, SURF_SPRAY_BURSTS at most: each thrown landward from the
 * crest's top at the lip's throw, the mean of 1.3 to 1.5 times the
 * shallow-water speed of a wave of the plunge's height. While the curl is
 * shown (`curl`) it is thrown along the swell's `travel`, as the curl throws
 * its lip; otherwise along the face's normal, as the sea's fragment lip,
 * which draws then, tilts. The plunges are `tracker`'s for the frame, on
 * `cove`, over a sea at `waterLevel`.
 */
export function createSprayThrow(
  tracker: LipTracker, cove: SwashCove, waterLevel: number,
): (curl: boolean, travel: readonly [number, number], camX: number, camZ: number, seconds: number, burst: SprayThrown) => void {
  // The plunges a frame has thrown spray for: made once, refilled.
  const thrown = new Uint8Array(tracker.plunges.d.length);
  return (curl, travel, camX, camZ, seconds, burst) => {
    const plunges = tracker.plunges;
    const count = Math.min(plunges.count, thrown.length);
    thrown.fill(0, 0, count);
    for (let k = 0; k < SURF_SPRAY_BURSTS; k++) {
      let best = -1;
      let bestDist = SURF_SPRAY_RANGE_M;
      for (let i = 0; i < count; i++) {
        if (thrown[i] === 1) continue;
        const z = plunges.z[i] as number;
        const dist = Math.hypot(cove.coastX(z) + (plunges.d[i] as number) - camX, z - camZ);
        if (dist <= bestDist) {
          best = i;
          bestDist = dist;
        }
      }
      if (best < 0) return;
      thrown[best] = 1;
      const z = plunges.z[best] as number;
      const height = Math.max(0, plunges.height[best] as number);
      // The coast runs along z with the land toward +x: its landward normal.
      const slope = (cove.coastX(z + 1) - cove.coastX(z - 1)) / 2;
      burst(
        cove.coastX(z) + (plunges.d[best] as number), waterLevel + height, z,
        curl ? travel[0] : 1, curl ? travel[1] : -slope,
        SURF_SPRAY_THROW * Math.sqrt(SWASH_G * height), seconds,
      );
    }
  };
}
