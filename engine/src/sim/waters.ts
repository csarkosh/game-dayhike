/**
 * The water a player meets: the walls a lake keeps a hull out of its deep water with, and the
 * level of the water over a place, the sea's or a lake's.
 *
 * sim/ determinism rules: no trig, no Math.pow, no `**`, no hypot.
 */
import type { Vec3 } from "./core.js";
import type { Forest } from "./forest.js";
import type { GroundField } from "./ground.js";
import { activeTerrainVariant } from "./terrain.js";
import {
  lakeShelfWidth, lakeShoreInto, newLakeShore, TARN_SHELF_HEAD, TARN_SHELF_OUTLET_SHARE, type LakeShape,
} from "./lakeShape.js";

/** What these read of a world: its forest for the seed, its ground, the sea's level. */
type Watered = { forest: Forest | null; ground: GroundField | null; waterLevel: number | null };

/**
 * The wall's shore distance in a lake at a point of side weight σ: the
 * shelf's inner edge, where the water is 0.9 m deep (spec §10.1), so a
 * player wades to the waist and the camera never goes under — a valley
 * lake's shelf width, a tarn's W_shelf(σ).
 */
export function lakeWallS(shape: LakeShape, sigma: number): number {
  if (shape.family === "valley") return lakeShelfWidth(shape.sMax);
  const wOut = TARN_SHELF_OUTLET_SHARE * shape.sMax;
  return wOut + (TARN_SHELF_HEAD - wOut) * sigma;
}

const WALL = newLakeShore();
/** The Newton steps the wall takes back along ∇s, and the step off the spine's ridge where ∇s vanishes (m). */
const WALL_STEPS = 6;
const WALL_RIDGE_STEP = 1e-3;
/** The step is over / |∇s|; a floor on |∇s| keeps a saddle's near-zero gradient from flinging the hull. */
const WALL_GRAD_MIN = 0.25;

/**
 * The wall in a lake: a hull's centre may not go deeper in than the wall's
 * shore distance (`lakeWallS`). Moves the hull back out along ∇s by Newton
 * steps onto that contour (off the spine's own ridge first, along +x, where
 * ∇s vanishes) and cancels the velocity into the lake.
 */
export function containAtLake(pos: Vec3, vel: Vec3, shape: LakeShape): boolean {
  let r = lakeShoreInto(WALL, shape, pos.x, pos.z);
  if (!(r.s > lakeWallS(shape, r.sigma))) return false;
  const x0 = pos.x, z0 = pos.z;
  for (let i = 0; i < WALL_STEPS; i++) {
    const g2 = r.sx * r.sx + r.sz * r.sz;
    if (g2 < 1e-12) {
      pos.x += WALL_RIDGE_STEP;
    } else {
      const over = r.s - lakeWallS(shape, r.sigma);
      if (Math.abs(over) < 1e-12) break;
      // The step is over / max(|∇s|, WALL_GRAD_MIN) along the unit gradient, so at most 4 · over.
      const g = Math.sqrt(g2);
      const k = over / (g * Math.max(g, WALL_GRAD_MIN));
      pos.x -= k * r.sx;
      pos.z -= k * r.sz;
    }
    r = lakeShoreInto(WALL, shape, pos.x, pos.z);
  }
  if (r.s === Number.NEGATIVE_INFINITY) {
    // The steps left the lake's bound: the read there has no gradient. Keep
    // the position the hull came in at and cancel its velocity as the ridge
    // case does, along the +x fallback.
    pos.x = x0;
    pos.z = z0;
  }
  const gl = Math.sqrt(r.sx * r.sx + r.sz * r.sz);
  // Out of the lake is down the shore distance.
  const nx = gl > 0 ? -r.sx / gl : 1;
  const nz = gl > 0 ? -r.sz / gl : 0;
  const inward = vel.x * nx + vel.z * nz;
  if (inward < 0) {
    vel.x -= inward * nx;
    vel.z -= inward * nz;
  }
  return true;
}

/**
 * The wall in each of a forest world's lakes (`containAtLake`), for any hull,
 * a player's or an enemy's, after its movement step. A hull the wall moved
 * out is lifted to stand on the ground there if it lay below it: the wall
 * puts it on the shelf, up the slope from where the step left it.
 */
export function containInLakes(world: Watered, pos: Vec3, vel: Vec3, half: Vec3): void {
  if (world.forest === null) return;
  const bodies = activeTerrainVariant().waterBodies?.(world.forest.seed);
  if (bodies === undefined) return;
  let walled = false;
  for (const b of bodies) {
    if (b.kind === "lake" && containAtLake(pos, vel, b.shape)) walled = true;
  }
  if (walled && world.ground !== null) {
    pos.y = Math.max(pos.y, world.ground.heightAt(pos.x, pos.z) + half.y);
  }
}

const WADE = newLakeShore();

/** The water a hull at (x, z) wades in: a lake's level inside its shore
 * (s > 0, the marsh within it), the world's sea level elsewhere. */
export function waterLevelAt(world: Watered, x: number, z: number): number | null {
  if (world.forest !== null) {
    const bodies = activeTerrainVariant().waterBodies?.(world.forest.seed);
    if (bodies !== undefined) {
      for (const b of bodies) {
        if (b.kind !== "lake") continue;
        if (lakeShoreInto(WADE, b.shape, x, z).s > 0) return b.level;
      }
    }
  }
  return world.waterLevel;
}
