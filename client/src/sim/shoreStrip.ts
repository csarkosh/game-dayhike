/**
 * The strip where the forest comes down to the road, at the trailhead.
 *
 * The road runs along the shore through ground low enough to be painted as
 * sand and to grow nothing, and the trailhead's pad stands in it. Inland of
 * the pad, for a way to either side of it, the shore's rules read the ground
 * as higher than it is, so grass and trees grow down to the road's verge
 * there. The ground's shape is not changed: only what the rules for sand,
 * grass, bushes, rocks and trees make of its height.
 *
 * A function of a place in the road's own frame and of nothing else: it
 * does not read the trail's graph, so the forest, the ground's cover and
 * the trail's search can each read it without waiting on another.
 *
 * sim/ determinism rules apply: no trig, no Math.pow, no `**`, no hypot.
 */
import { TRAIL_Z_ANCHOR } from "./bowl.js";
import { ROAD_BED_HALF } from "./road.js";
import { activeTerrainVariantName, terrainVariant } from "./terrain.js";

/** Along the road from the pad, to either side, the strip is whole (m). */
export const STRIP_HALF = 30;
/** Past that it fades out over this (m): the forest thins into the sand. */
export const STRIP_EDGE = 15;
/** Inland of the road's centreline the strip is whole to here (m). */
export const STRIP_REACH = 100;
/** Past that it fades out over this (m). */
export const STRIP_FADE = 20;
/** What the shore's rules add to the ground's height where the strip is whole (m). */
export const STRIP_LIFT = 9;
/** The least the forest's density is where the strip is whole and the road's verge is cleared. */
export const STRIP_FOREST_FLOOR = 1;

export const SHORE_STRIP_TUNABLES: Readonly<Record<string, number>> = {
  STRIP_HALF, STRIP_EDGE, STRIP_REACH, STRIP_FADE, STRIP_LIFT, STRIP_FOREST_FLOOR,
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (x <= edge0) return 0;
  if (x >= edge1) return 1;
  const t = (x - edge0) / (edge1 - edge0);
  return t * t * (3 - 2 * t);
}

/**
 * The strip's weight at `u` metres inland of the road's centreline and `w`
 * metres along the road from the pad, without its sign. Nothing seaward of
 * the centreline; it rises across the road's bed, under the pavement.
 */
export function shoreStripAt(u: number, w: number): number {
  if (u <= 0 || u >= STRIP_REACH + STRIP_FADE || w >= STRIP_HALF + STRIP_EDGE) return 0;
  const along = 1 - smoothstep(STRIP_HALF, STRIP_HALF + STRIP_EDGE, w);
  const inland = smoothstep(0, ROAD_BED_HALF, u) * (1 - smoothstep(STRIP_REACH, STRIP_REACH + STRIP_FADE, u));
  return along * inland;
}

/** The strip's weight at a place: 0 on a world with no road, and where no world is registered at all. */
export function shoreStrip(seed: number, x: number, z: number): number {
  const dz = z - TRAIL_Z_ANCHOR;
  const w = dz < 0 ? -dz : dz;
  if (w >= STRIP_HALF + STRIP_EDGE) return 0;
  const centre = terrainVariant(activeTerrainVariantName())?.roadCenterX?.(seed, z);
  if (centre === undefined) return 0;
  return shoreStripAt(x - centre, w);
}

/** The height the shore's rules read at a place whose ground is `h` high: `h` itself outside the strip. */
export function shoreHeight(seed: number, x: number, z: number, h: number): number {
  const s = shoreStrip(seed, x, z);
  return s === 0 ? h : h + STRIP_LIFT * s;
}
