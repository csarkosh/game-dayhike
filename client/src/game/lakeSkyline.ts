import { elevationAt, type LakeSource } from "../sim/terrain.js";
import { COHORT_GIANT, COHORT_SAPLING, COHORT_SNAG, treesInRect } from "../sim/vegetation.js";
import { GIANT_MODEL_HEIGHT } from "./wildlifeField.js";

/**
 * The lake's skyline, Babylon-free and on BABYLON_FREE_FILES: the treeline's
 * elevation by azimuth as seen from the lake's centre just over the water,
 * computed once a world from the terrain and the forest's placement. On the
 * medium tier it masks the shore panorama's sky; on the low tier it is the
 * whole shore, a forest colour under it and the probe over it. And the
 * reflected ray's hit on the shore's cylinder, which the panorama is read at.
 *
 * Azimuth runs as the player's yaw does: u = atan2(dx, dz) / 2π wrapped to
 * 0..1, so u 0 faces +z and u 0.25 faces +x. Texel i holds the azimuth at
 * its centre, u = (i + 0.5) / SKYLINE_TEXELS.
 */

/** Azimuth texels about the lake's centre. */
export const SKYLINE_TEXELS = 512;
/** The shore band the skyline reads, metres past the rim: from the rim's tree margin, then this far. */
export const SKYLINE_RIM_MARGIN = 8;
export const SKYLINE_REACH = 60;
/** The eye over the level the skyline is seen from, as the panorama's capture is. */
export const SKYLINE_EYE_UP = 0.4;
/** The terrain's march along an azimuth, metres a step. */
export const SKYLINE_STEP = 2;
/** A crown's half-width at its foot over its height: a tree stands as a cone this wide. */
export const SKYLINE_CROWN = 0.25;
/** The low tier's forest colour under the skyline: the probe's horizon colour times this. */
export const SKYLINE_SHADE = 0.15;

/**
 * A model's height at scale 1 (m), by `TreeInstance.species`, for the
 * regeneration cohort: conifer_a, conifer_b, the alder (the top of each
 * shipped model's LOD0, `tree.conifer_a.glb`, `tree.conifer_b.glb`,
 * `tree.alder.glb`). The giants' are `GIANT_MODEL_HEIGHT`.
 */
export const SAPLING_MODEL_HEIGHT: readonly number[] = [8.86, 10.51, 4.72];
/** A standing snag's height at scale 1 (m): `deadwood.snag.glb`'s 4.05 m trunk, stood upright. */
export const SNAG_MODEL_HEIGHT = 4.05;

/** A tree as the skyline reads it: where it stands and its height over its own ground (m). */
export type SkylineTree = { x: number; z: number; height: number };

/**
 * Every standing tree whose foot is within the skyline's reach of the
 * lake's centre (`radius + SKYLINE_RIM_MARGIN + SKYLINE_REACH`), from the
 * forest's own placement (`treesInRect`, the cells the forest draws):
 * height = the model's height × the tree's `scale` (giants by
 * `GIANT_MODEL_HEIGHT[species]`, saplings and alders by
 * `SAPLING_MODEL_HEIGHT[species]`, snags `SNAG_MODEL_HEIGHT`); fallen logs
 * stand on no skyline and are left out.
 */
export function skylineTrees(lake: LakeSource, seed: number): SkylineTree[] {
  const reach = lake.radius + SKYLINE_RIM_MARGIN + SKYLINE_REACH;
  const out: SkylineTree[] = [];
  for (const t of treesInRect(seed, lake.x - reach, lake.z - reach, lake.x + reach, lake.z + reach)) {
    if (Math.hypot(t.x - lake.x, t.z - lake.z) > reach) continue;
    let model: number;
    if (t.cohort === COHORT_GIANT) model = GIANT_MODEL_HEIGHT[t.species] ?? 0;
    else if (t.cohort === COHORT_SAPLING) model = SAPLING_MODEL_HEIGHT[t.species] ?? 0;
    else if (t.cohort === COHORT_SNAG) model = SNAG_MODEL_HEIGHT;
    else continue;
    out.push({ x: t.x, z: t.z, height: model * t.scale });
  }
  return out;
}

/**
 * The treeline's elevation (radians over the horizontal, 0..π/2) by azimuth
 * texel, seen from (lake.x, lake.level + SKYLINE_EYE_UP, lake.z): along each
 * texel's azimuth the terrain from `radius + SKYLINE_RIM_MARGIN` to
 * `radius + SKYLINE_RIM_MARGIN + SKYLINE_REACH` every SKYLINE_STEP metres,
 * and over it every tree of `trees` whose foot lies between the rim and that
 * reach, each a cone SKYLINE_CROWN of its height wide at its foot, its top
 * at the terrain's height under it plus its `height`. The highest wins.
 */
export function skylineElevations(lake: LakeSource, seed: number, trees: ReadonlyArray<SkylineTree>): Float32Array {
  const out = new Float32Array(SKYLINE_TEXELS);
  const eyeY = lake.level + SKYLINE_EYE_UP;
  const near = lake.radius + SKYLINE_RIM_MARGIN;
  const far = near + SKYLINE_REACH;
  const steps = Math.round(SKYLINE_REACH / SKYLINE_STEP);
  for (let i = 0; i < SKYLINE_TEXELS; i++) {
    const a = (2 * Math.PI * (i + 0.5)) / SKYLINE_TEXELS;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    let best = 0;
    for (let s = 0; s <= steps; s++) {
      const r = near + s * SKYLINE_STEP;
      const h = elevationAt(seed, lake.x + dx * r, lake.z + dz * r);
      best = Math.max(best, Math.atan2(h - eyeY, r));
    }
    out[i] = best;
  }
  for (const t of trees) {
    const ox = t.x - lake.x;
    const oz = t.z - lake.z;
    const d = Math.hypot(ox, oz);
    if (d < lake.radius || d > far || !(t.height > 0)) continue;
    const top = elevationAt(seed, t.x, t.z) + t.height;
    const centre = Math.atan2(ox, oz);
    const halfWidth = SKYLINE_CROWN * t.height;
    const span = Math.atan2(halfWidth, d);
    const first = Math.floor(((centre - span) / (2 * Math.PI)) * SKYLINE_TEXELS - 0.5);
    const last = Math.ceil(((centre + span) / (2 * Math.PI)) * SKYLINE_TEXELS - 0.5);
    for (let k = first; k <= last; k++) {
      const a = (2 * Math.PI * (k + 0.5)) / SKYLINE_TEXELS;
      const off = Math.abs(a - centre);
      if (off > span) continue;
      const lateral = d * Math.tan(off);
      const y = top - lateral / SKYLINE_CROWN;
      const e = Math.atan2(y - eyeY, d);
      const i = ((k % SKYLINE_TEXELS) + SKYLINE_TEXELS) % SKYLINE_TEXELS;
      if (e > out[i]!) out[i] = e;
    }
  }
  for (let i = 0; i < SKYLINE_TEXELS; i++) out[i] = Math.min(Math.PI / 2, Math.max(0, out[i]!));
  return out;
}

/**
 * The reflected ray from `origin` (on the surface) along the unit `dir`
 * against the vertical cylinder of `radius` about (cx, cz): where it leaves
 * the cylinder (the far shore), as the hit's azimuth u (0..1, as texel u
 * reads) and its height over `level`. Null when it never leaves it ahead: a
 * ray with no horizontal part, or one from outside the cylinder that points
 * away from it or passes it by.
 */
export function cylinderHit(
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  cx: number,
  cz: number,
  radius: number,
  level: number,
): { u: number; height: number } | null {
  const px = origin[0] - cx;
  const pz = origin[2] - cz;
  const a = dir[0] * dir[0] + dir[2] * dir[2];
  if (a < 1e-12) return null;
  const b = px * dir[0] + pz * dir[2];
  const c = px * px + pz * pz - radius * radius;
  const disc = b * b - a * c;
  if (disc < 0) return null;
  const t = (-b + Math.sqrt(disc)) / a;
  if (!(t > 0)) return null;
  const hx = px + dir[0] * t;
  const hz = pz + dir[2] * t;
  let u = Math.atan2(hx, hz) / (2 * Math.PI);
  if (u < 0) u += 1;
  if (u >= 1) u -= 1;
  return { u, height: origin[1] + dir[1] * t - level };
}
