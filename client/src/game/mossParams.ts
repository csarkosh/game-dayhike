/**
 * The moss on the trunks: where it grows and how it reads. Babylon-free and
 * on the architecture test's BABYLON_FREE_FILES list; the moss plugin's
 * shader holds every constant as a literal (`mossPlugin.ts`,
 * `shaders/moss.fragment.fx`) and a lockstep test pins each to its value
 * here. Every value is a starting value, one literal to change, settled in
 * the browser (`docs/rendering/2026-10-14-trunk-moss-design.md`).
 *
 * The mask is four terms, multiplied, then given an edge: how low on the
 * trunk (`MOSS_BAND`), how far round toward the wet side (`MOSS_SIDE`), how
 * much this tree carries (`MOSS_AMOUNT`, by a draw hashed from its foot), and
 * where the moss map's own growth is (its luminance: the map is moss grown
 * over wood, bright where the moss is and dark where the wood shows). The
 * bark's relief and roughness maps stay under the moss, so the moss sits in
 * the bark's fissures as the bark's own light does.
 */
import type { Rgb } from "./colour.js";

/** The catalog `output` of the moss colour map (`client/assets/catalog.json`,
 * `textures`): moss grown over wood, a 1.00 × 1.00 m plate at 1024 px, sRGB.
 * Its normal and ARM maps ship beside it and are not read: the bark's own
 * relief and roughness stay under the moss. */
export const MOSS_OUTPUT = "textures/moss.wood.1k.ktx2";

/** The wet side of a trunk, a unit vector in world space: toward −x and +z,
 * and a little up, so the moss leans to one quarter of the trunk and up its
 * top-facing flanks. The side term is the geometric normal's dot with it,
 * blended in from 0 to 0.6 (`MOSS_SIDE_EDGE`). */
export const MOSS_SIDE: { readonly x: number; readonly y: number; readonly z: number } = { x: -0.5486, y: 0.2494, z: 0.798 };

/** The dot the side term reaches 1 at: a face turned within about 53° of
 * the wet side carries the full side weight, one turned square to it none. */
export const MOSS_SIDE_EDGE = 0.6;

/** The band up the trunk, in the model's own metres above its foot: full
 * below the first, gone above the second. A giant is drawn at about 3.5
 * times its model, so this is 3.5 to 9 m on a giant's trunk and the model's
 * own metres on a sapling drawn at 1. */
export const MOSS_BAND: readonly [number, number] = [1.0, 2.5];

/** How much moss a tree carries, by its draw: the least tree a quarter of
 * the mask, the most the whole of it. */
export const MOSS_AMOUNT: readonly [number, number] = [0.25, 1.0];

/** The edge the mask is given: the raw mask, times the moss map's own
 * growth (half plus its luminance), blended from the first to the second,
 * so the moss has an edge where it thins rather than a fade to a tint. */
export const MOSS_EDGE: readonly [number, number] = [0.35, 0.65];

/** Repeats of the moss plate per repeat of the bark's: the moss map is
 * read on the bark's own tiled UVs, so a bark plate 2 m up the trunk
 * carries three moss plates. */
export const MOSS_TILE = 3.0;

/** What the moss map's colour is multiplied by, linear: a little toward
 * green and away from the scan's warmth, so the moss sits under the canopy
 * with the toned bark (`BARK_TONE`). */
export const MOSS_TINT: Rgb = { r: 0.85, g: 1.0, b: 0.75 };

/** The moss's roughness, a constant: a mat surface, mixed over the bark's
 * own roughness by the mask's weight. */
export const MOSS_ROUGHNESS = 0.95;

/** The luminance weights the moss map's growth is read by (linear Y). */
export const MOSS_LUMA: Rgb = { r: 0.2126, g: 0.7152, b: 0.0722 };

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * The mask's weight, as `shaders/mossLights.fragment.fx` computes it: the
 * moss's share of a fragment's albedo and roughness, 0 to 1. `height` is the
 * fragment's height above the tree's foot in the model's metres, `facing`
 * the dot of the geometric normal with `MOSS_SIDE`, `draw` the tree's own
 * draw in [0, 1), and `luma` the luminance of the moss map where it is read.
 */
export function mossWeight(height: number, facing: number, draw: number, luma: number): number {
  const band = 1 - smoothstep(MOSS_BAND[0], MOSS_BAND[1], height);
  const side = smoothstep(0, MOSS_SIDE_EDGE, facing);
  const tree = MOSS_AMOUNT[0] + (MOSS_AMOUNT[1] - MOSS_AMOUNT[0]) * draw;
  return smoothstep(MOSS_EDGE[0], MOSS_EDGE[1], band * side * tree * (0.5 + luma));
}
