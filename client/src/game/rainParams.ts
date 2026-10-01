/**
 * The rain's numbers and the arithmetic the streak plugin's vertex stage
 * runs, in TypeScript so the tests can pin them. Babylon-free and on
 * BABYLON_FREE_FILES. Renderer-only by design: nothing here may migrate into
 * sim/ or a tunables registry. Rain is cosmetic, peers need not agree on it,
 * and a rain constant in the level id would break invite links.
 *
 * The air is a fixed population of streaks in a box locked to the camera.
 * A drop is a seed `s` in the unit cube and a class `k`; its world position
 * each frame is
 *
 *   q = fract(s + drift - boxMin / boxSize)
 *   p = boxMin + q * boxSize
 *
 * with `drift = (driftX, -speed_k * fold / boxSize.y, driftZ)`. `boxMin` is
 * subtracted INSIDE the fract, so the field of drops stands still in the
 * world while the box slides over it: a camera move changes which drops are
 * in the box, never where a drop is (`rainDropAt`, pinned by the tests). The
 * vertical fold is exact because every class speed times RAIN_FOLD_S is a
 * whole number of box heights; the horizontal fold is exact because the wind
 * is one velocity for every drop, accumulated here and folded modulo 1.
 */
import { clamp01 } from "./colour.js";
import type { QualityTier } from "./quality.js";
import type { WindRecord } from "./windParams.js";

/** Streaks in the box, by quality tier. */
export const RAIN_TIERS: Record<QualityTier, number> = { low: 3000, medium: 10000, high: 24000 };

/** The box, metres: its size, how far its centre sits ahead of the eye along
 * the horizontal view direction, and how far below the eye. */
export const RAIN_BOX = { x: 24, y: 20, z: 24, forward: 6, down: 2 } as const;

/** The running time folds modulo this many seconds. */
export const RAIN_FOLD_S = 40;

export type RainClass = {
  /** Fall speed, m/s. Times RAIN_FOLD_S it must be a whole number of box heights. */
  speed: number;
  /** Streak width, metres. */
  width: number;
  /** Peak alpha: visibility rises with drop size. */
  alpha: number;
};

/** Four fall-speed classes; a seed's class is `k` in {0, 1/3, 2/3, 1}. */
export const RAIN_CLASSES: readonly RainClass[] = [
  { speed: 4.5, width: 0.012, alpha: 0.35 },
  { speed: 6, width: 0.018, alpha: 0.43 },
  { speed: 7.5, width: 0.024, alpha: 0.52 },
  { speed: 9, width: 0.03, alpha: 0.6 },
];

/** The streak's length is the class speed times the frame's duration times
 * this, so it reads as the motion blur of that frame. */
export const RAIN_STRETCH = 1.5;
/** The length's clamp, metres. */
export const RAIN_LENGTH: readonly [number, number] = [0.08, 0.5];
/** Alpha fades in across this range from the eye, so no quad fills the screen. */
export const RAIN_FADE_NEAR: readonly [number, number] = [0.6, 1.5];
/** And out across this, before the box's far face at 12 m. */
export const RAIN_FADE_FAR: readonly [number, number] = [9, 12];
/** How much of a streak's alpha the bright sky takes, looking straight up. */
export const RAIN_SKY_FADE = 0.6;
/** The streak colour is the fog colour times `gain` plus `lift`. */
export const RAIN_MILK = { gain: 1.15, lift: 0.05 } as const;
/** Downwind drift, m/s, at wind speed 1. */
export const RAIN_SLANT = 3;
/** The headlamp's intensity (Babylon light units, 400 when on) times this is
 * the alpha a drop on the lamp's axis gains at `1 / (1 + d²)`: 1 at 1 m,
 * 0.2 at 3 m. Higher, and the drops nearest the eye are solid bars. */
export const RAIN_LAMP_GAIN = 0.005;
/** The frame duration the streak length reads is smoothed over this many
 * frames and clamped to this range, seconds. */
export const RAIN_DT_FRAMES = 10;
export const RAIN_DT: readonly [number, number] = [1 / 120, 1 / 30];

/** Positive modulo. */
function fract(v: number): number {
  return v - Math.floor(v);
}

/** The running time, folded modulo RAIN_FOLD_S. */
export function rainFold(seconds: number): number {
  return seconds - Math.floor(seconds / RAIN_FOLD_S) * RAIN_FOLD_S;
}

/** The class a seed's `k` picks. */
export function rainClassOf(k: number): RainClass {
  return RAIN_CLASSES[Math.round(k * 3)] as RainClass;
}

/**
 * `count` seeds, xyz in [0, 1) and w the class `k`, from an integer hash of
 * the index and `seed`; the same on every load. The hash is Wang's 32-bit mix,
 * written with integer arithmetic only.
 */
export function rainSeeds(count: number, seed: number): Float32Array {
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
  for (let i = 0; i < count; i++) {
    h = mix(h + 0x9e3779b9);
    out[i * 4] = (h >>> 8) / 16777216;
    h = mix(h + 0x9e3779b9);
    out[i * 4 + 1] = (h >>> 8) / 16777216;
    h = mix(h + 0x9e3779b9);
    out[i * 4 + 2] = (h >>> 8) / 16777216;
    out[i * 4 + 3] = (i % 4) / 3;
  }
  return out;
}

export type Vec3 = { x: number; y: number; z: number };
export type Drift = { x: number; z: number };

/** The box's low corner for an eye at `cam` facing `yaw` (Babylon's: 0 faces
 * +Z, forward is (sin yaw, 0, cos yaw)), written into `out` (a fresh object
 * when none is given) so a caller on the frame path allocates nothing. The
 * box is RAIN_BOX's size unless `size` says otherwise (the drip volume's,
 * DRIP.box); its offset from the eye is RAIN_BOX's either way. */
export function rainBoxMin(cam: Vec3, yaw: number, out: Vec3 = { x: 0, y: 0, z: 0 }, size: Vec3 = RAIN_BOX): Vec3 {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  out.x = cam.x + fx * RAIN_BOX.forward - size.x / 2;
  out.y = cam.y - RAIN_BOX.down - size.y / 2;
  out.z = cam.z + fz * RAIN_BOX.forward - size.z / 2;
  return out;
}

/** The wind's horizontal displacement over `dt` seconds added to `prev`, in
 * units of the box and folded to [0, 1) per component, written into `out`
 * (a fresh object when none is given; `prev` itself is allowed). */
export function rainDrift(prev: Drift, wind: WindRecord, dt: number, out: Drift = { x: 0, z: 0 }): Drift {
  const metres = RAIN_SLANT * wind.speed * dt;
  const x = fract(prev.x + (wind.dirX * metres) / RAIN_BOX.x);
  const z = fract(prev.z + (wind.dirZ * metres) / RAIN_BOX.z);
  out.x = x;
  out.z = z;
  return out;
}

/** The streak's length for a class speed and a frame duration, metres. */
export function streakLength(speed: number, dt: number): number {
  return Math.min(RAIN_LENGTH[1], Math.max(RAIN_LENGTH[0], speed * dt * RAIN_STRETCH));
}

/** The frame duration the streak reads: `dt` clamped to RAIN_DT, then eased
 * toward over RAIN_DT_FRAMES frames, so the length holds as the frame rate
 * moves. */
export function smoothedDt(prev: number, dt: number): number {
  const clamped = Math.min(RAIN_DT[1], Math.max(RAIN_DT[0], dt));
  const next = prev + (clamped - prev) / RAIN_DT_FRAMES;
  return Math.min(RAIN_DT[1], Math.max(RAIN_DT[0], next));
}

/**
 * The vertex stage's placement of one drop, mirrored: `seed` is the drop's
 * xyz, `k` its class, `drift` the folded horizontal drift, `fold` the folded
 * time and `boxMin` the box's low corner this frame. World metres.
 */
export function rainDropAt(seed: Vec3, k: number, drift: Drift, fold: number, boxMin: Vec3): Vec3 {
  const speed = rainClassOf(k).speed;
  const qx = fract(seed.x + drift.x - boxMin.x / RAIN_BOX.x);
  const qy = fract(seed.y - (speed * fold) / RAIN_BOX.y - boxMin.y / RAIN_BOX.y);
  const qz = fract(seed.z + drift.z - boxMin.z / RAIN_BOX.z);
  return { x: boxMin.x + qx * RAIN_BOX.x, y: boxMin.y + qy * RAIN_BOX.y, z: boxMin.z + qz * RAIN_BOX.z };
}

/** The streaks drawn at a rain value: `round(rain × tier)`. */
export function rainCountUnder(rain: number, tier: QualityTier): number {
  return Math.round(clamp01(rain) * RAIN_TIERS[tier]);
}

/**
 * The splashes (`rainSplash.ts`): short-lived rings on the cover map's
 * surface in a disc of `radius` metres around the eye, each living `life`
 * seconds and `size[0]` to `size[1]` metres wide. None on low, which has no
 * map to land them on.
 */
export const SPLASH_TIERS: Record<QualityTier, number> = { low: 0, medium: 600, high: 1200 };
export const SPLASH = { radius: 10, life: 0.12, size: [0.06, 0.1] as readonly [number, number] } as const;

/** The splashes' running time folds modulo this many seconds: a whole number
 * of lives (SPLASH_CYCLES), so the fold lands on a cycle's boundary and
 * every ring's phase runs on unbroken. The cycle a ring is on is counted
 * modulo SPLASH_CYCLES in the vertex stage, so the hash that places it is
 * the same on either side of the fold. */
export const SPLASH_FOLD_S = 36;
export const SPLASH_CYCLES = 300;

/** The running time, folded modulo SPLASH_FOLD_S. */
export function splashFold(seconds: number): number {
  return seconds - Math.floor(seconds / SPLASH_FOLD_S) * SPLASH_FOLD_S;
}

/** The splashes drawn at a rain value: `round(rain × tier)`. */
export function splashCountUnder(rain: number, tier: QualityTier): number {
  return Math.round(clamp01(rain) * SPLASH_TIERS[tier]);
}

/**
 * The drips (`rain.ts`, the streak plugin under `RAIN_DRIP`): large, slow
 * drops falling straight down under the canopy, in a box of their own
 * (shorter than the streaks': they start at branch height) placed as the
 * streak box is. `speed` times RAIN_FOLD_S must be a whole number of box
 * heights, as a streak class's must: 6 × 40 / 12 = 20, exact.
 */
export const DRIP_TIERS: Record<QualityTier, number> = { low: 0, medium: 600, high: 1000 };
export const DRIP = { speed: 6, width: 0.04, length: 0.12, box: { x: 24, y: 12, z: 24 } } as const;

/** The drips drawn at a canopy water (`canopyWaterStep` in `weather.ts`,
 * stepped by `rain.ts`): `round(water × tier)`. */
export function dripCountUnder(water: number, tier: QualityTier): number {
  return Math.round(clamp01(water) * DRIP_TIERS[tier]);
}

/**
 * The ripples' rings: the puddle plane is cut into cells of one metre over
 * `scale`, and each cell holds one ring, its centre, its radius' share and
 * its phase hashed from the cell (the hex include's `latticeHash`, in the
 * shader). The rings are made in the fragment rather than read from a
 * texture: the terrain's fragment stage already samples the sixteen
 * textures WebGPU's default per-stage limit allows, which the engine keeps
 * at the default on purpose (`stageBindings.test.ts`). `RIPPLE_RADIUS` is a
 * ring's radius as a share of its cell, and `RIPPLE_INSET` how far from the
 * cell's edges, in cells, its centre sits at least: the ring never leaves
 * its cell.
 */
export const RIPPLE_RADIUS = 0.25;
export const RIPPLE_INSET = 0.25;

/** One layer of ripples on a puddle: the cells read at `scale` a metre from
 * `offset`, their rings' phase run at `timeMul` cycles a second from
 * `timeAdd`. The layers blend in one per quarter of the rain value. */
export type RippleLayer = { timeMul: number; timeAdd: number; scale: number; offset: readonly [number, number] };

export const RIPPLE_LAYERS: readonly RippleLayer[] = [
  { timeMul: 1, timeAdd: 0, scale: 2.5, offset: [0, 0] },
  { timeMul: 0.85, timeAdd: 0.2, scale: 3.2, offset: [0.37, 0.61] },
  { timeMul: 0.93, timeAdd: 0.45, scale: 2.1, offset: [0.71, 0.13] },
  { timeMul: 1.13, timeAdd: 0.7, scale: 3.8, offset: [0.19, 0.83] },
];

/** The running time the ripples read folds modulo this many seconds. Every
 * layer's `timeMul` times it is a whole number, so the fold moves no ring. */
export const RIPPLE_TIME_WRAP = 3600;

/** The running time, folded modulo RIPPLE_TIME_WRAP. */
export function rippleTime(seconds: number): number {
  return seconds - Math.floor(seconds / RIPPLE_TIME_WRAP) * RIPPLE_TIME_WRAP;
}

/**
 * The cover map (`rainMap.ts`): a top-down render target of `texels` a side
 * over `extent` metres around the player, looked down on from `height` metres
 * above them, re-rendered once they have moved `step` metres from the centre
 * it was last drawn at. Terrain under canopy writes a transmission of
 * `1 - canopyBlock × density` (an old-growth canopy intercepts or delays about
 * two thirds of the rain) and a ceiling `canopyLift` metres above the ground,
 * under which a streak counts as covered.
 */
export const RAIN_MAP = { texels: 512, extent: 96, height: 100, step: 8, canopyBlock: 0.65, canopyLift: 10 } as const;

/**
 * The map's centre for a player at `player`: `prev` until the player is more
 * than RAIN_MAP.step from it horizontally, then the player's own position,
 * written into `out` (a fresh object when none is given; `prev` itself is
 * allowed). The y is the player's at the move: the map's camera stands
 * RAIN_MAP.height above it, and looks the same distance below.
 */
export function mapCentre(prev: Vec3, player: Vec3, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const dx = player.x - prev.x;
  const dz = player.z - prev.z;
  const moved = dx * dx + dz * dz > RAIN_MAP.step * RAIN_MAP.step;
  out.x = moved ? player.x : prev.x;
  out.y = moved ? player.y : prev.y;
  out.z = moved ? player.z : prev.z;
  return out;
}
