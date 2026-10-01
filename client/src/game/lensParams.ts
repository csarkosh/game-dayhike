/**
 * Rain on the lens: the droplet texture the pass refracts the frame through,
 * generated here, and the gating that decides how strong it is. Babylon-free
 * and on BABYLON_FREE_FILES; `post.ts` owns the pass.
 *
 * The map is `LENS.size` texels square, RGBA. RG hold a spherical-cap normal
 * packed around 128, B the drop's coverage with a soft edge one texel wide,
 * A a short trail below the drop (the glass it ran down, which the pass
 * leaves clear of fog). Outside every drop a texel is (128, 128, 0, 0): a
 * flat normal, no cover, no trail. Drops keep clear of the map's edges by
 * their own radius and their trail's length, so a tile may be flipped or
 * shifted inside that margin without cutting a drop at the seam.
 */
import { clamp01 } from "./colour.js";

export const LENS = {
  /** The droplet map's side, texels. */
  size: 128,
  /** Static drops in the map. */
  drops: 40,
  /** A drop's radius, as a fraction of the map's side. */
  radius: [0.02, 0.05] as readonly [number, number],
  /** Times the map tiles across the frame's height. */
  tiles: 2,
  /** The refraction: the scene's UV moves against the normal by strength × this, less than a drop's radius. */
  offset: 0.012,
  /** Columns the procedural sliding drops fall in. */
  columns: 8,
  /** How far the pass may shift a tile of the map, each way: the margin the drops keep. */
  jitter: 0.05,
  /** The strength's smoothing time constant, seconds. */
  smoothS: 1,
  /** Below this strength the pass draws nothing worth its cost and is skipped. */
  floor: 0.02,
} as const;

/** A trail is this many radii long, straight down from the drop's centre. */
export const LENS_TRAIL = 2.5;
/** A trail is this fraction of the drop's radius wide at its top. */
export const LENS_TRAIL_WIDTH = 0.5;
/** The cap's slope: the packed normal's xy is the unit offset from the centre times this. */
export const LENS_CAP = 0.8;

/** A 32-bit integer mix (the finaliser of Thomas Wang's hash): deterministic everywhere. */
function mix32(a: number): number {
  let h = a | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A unit value in [0, 1) from a seed, a drop index and a channel. */
function unit(seed: number, i: number, k: number): number {
  return mix32(Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca77) ^ Math.imul(k + 1, 0xc2b2ae3d)) / 4294967296;
}

export type LensDrop = {
  /** The centre texel's column. */
  x: number;
  /** The centre texel's row, 0 at the bottom of the map. */
  y: number;
  /** The radius, as a fraction of the map's side. */
  r: number;
};

/**
 * The static drops of a seed: centres on texel centres, inside a margin of
 * the drop's radius, its trail below, and the shift the pass may give a tile,
 * plus one texel so flooring the centre cannot push a drop over its edge.
 */
export function lensDrops(seed = 1): LensDrop[] {
  const [rMin, rMax] = LENS.radius;
  const texel = 1 / LENS.size;
  const side = rMax + LENS.jitter + texel;
  const bottom = rMax * (1 + LENS_TRAIL) + LENS.jitter + texel;
  const drops: LensDrop[] = [];
  for (let i = 0; i < LENS.drops; i++) {
    const r = rMin + (rMax - rMin) * unit(seed, i, 2);
    const x = Math.floor((side + (1 - 2 * side) * unit(seed, i, 0)) * LENS.size);
    const y = Math.floor((bottom + (1 - bottom - side) * unit(seed, i, 1)) * LENS.size);
    drops.push({ x, y, r });
  }
  return drops;
}

/** The droplet map: RG the cap normal, B the cover, A the trail, row 0 at the bottom. */
export function lensDropletMap(seed = 1): Uint8Array {
  const size = LENS.size;
  const map = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    map[i * 4] = 128;
    map[i * 4 + 1] = 128;
  }
  const texel = 1 / size;
  for (const drop of lensDrops(seed)) {
    const cx = (drop.x + 0.5) * texel;
    const cy = (drop.y + 0.5) * texel;
    const reach = drop.r + texel;
    const trail = drop.r * LENS_TRAIL;
    const x0 = Math.max(0, Math.floor((cx - reach) * size));
    const x1 = Math.min(size - 1, Math.ceil((cx + reach) * size));
    const y0 = Math.max(0, Math.floor((cy - trail) * size));
    const y1 = Math.min(size - 1, Math.ceil((cy + reach) * size));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5) * texel - cx;
        const dy = (y + 0.5) * texel - cy;
        const d = Math.hypot(dx, dy);
        const at = (y * size + x) * 4;
        const cover = clamp01((drop.r - d) / texel + 0.5);
        if (cover > 0) {
          if (cover * 255 > (map[at + 2] as number)) {
            // The unit offset from the centre, held to length 1 at the soft edge.
            const slope = (LENS_CAP * 127) / Math.max(drop.r, d);
            map[at] = Math.round(128 + dx * slope);
            map[at + 1] = Math.round(128 + dy * slope);
            map[at + 2] = Math.round(cover * 255);
          }
          continue;
        }
        // Below the drop: a streak that narrows and fades over its length.
        if (dy < 0 && -dy < trail + drop.r) {
          const along = clamp01((-dy - drop.r) / trail);
          const width = drop.r * LENS_TRAIL_WIDTH * (1 - along);
          const across = clamp01((width - Math.abs(dx)) / texel + 0.5);
          const value = Math.round(255 * (1 - along) * across);
          if (value > (map[at + 3] as number)) map[at + 3] = value;
        }
      }
    }
  }
  return map;
}

/** Hermite step between two edges, in either order. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/**
 * The strength the lens heads for: the rain, scaled by the camera's pitch
 * (positive looking down: full strength looking up into the rain, a quarter
 * looking ahead) and by what the canopy over the camera keeps off the glass.
 */
export function lensStrengthUnder(rain: number, pitch: number, canopy: number): number {
  return clamp01(rain) * (0.25 + 0.75 * smoothstep(0.1, -0.5, pitch)) * (1 - 0.65 * clamp01(canopy));
}

/** One frame's exponential approach to the target, time constant LENS.smoothS. */
export function lensSmooth(prev: number, target: number, dt: number): number {
  return prev + (target - prev) * (1 - Math.exp(-dt / LENS.smoothS));
}
