import type { Vec3 } from "./types.js";
import { elevationSampleAt } from "./terrain.js";
import { GROUND_NORMAL_Y, ROCK_STAND_NORMAL_Y } from "./constants.js";
import { rockLayerAt, rockPaintAt, rockRiseAt, trailClearAt } from "./rockSurface.js";
import type { TrailGraph } from "./trail.js";

/**
 * The ground the simulation collides with: the active variant's continuous
 * elevation field — the same field `game/clipmap.ts` draws.
 *
 * This exists because those two used to be different surfaces. Collision ran
 * against a lattice of flat-topped 1 m columns quantized to HEIGHT_QUANTUM
 * (`chunkGrid.ts`), while the renderer sampled the analytic field. A player
 * walking downhill therefore strolled along a flat column top, walked off its
 * edge, fell under gravity, and landed on the next one — measured at 196
 * airborne ticks in 240, five landings a second, with the hull sitting a median
 * 0.57 m above the ground it could see. That is the whole of what "walking
 * feels jagged" was.
 *
 * Props (trunks) are still boxes and still collide as boxes: they genuinely are
 * box-shaped, and a heightfield cannot represent them. Only the ground moved.
 *
 * Since 2026-10-13 the field carries the walkable rock's layer
 * (`rockSurface.ts`, off the trail's bed by the graph given): where the surface paints rock, the renderer draws
 * fractured plates up to a metre out of the ground, and the player stands
 * on their walking twin, smooth to walk and one surface with the drawn rock
 * on a plate's top. Nothing is added where the paint is not rock, exactly,
 * so the ground there is the elevation field's own doubles.
 */
export type GroundField = {
  /** Surface height in metres at (x, z). */
  heightAt(x: number, z: number): number;
  /**
   * Upward unit normal at (x, z), written into `out` to keep the per-tick path
   * allocation-free. Exact, not estimated: the variant reports analytic
   * ∂h/∂x and ∂h/∂z, so no finite differencing is involved.
   */
  normalAt(x: number, z: number, out: Vec3): void;
  /**
   * The least upward normal the player can stand on at (x, z): GROUND_NORMAL_Y,
   * or ROCK_STAND_NORMAL_Y where the walkable rock's layer stands, a scramble
   * over the plates' ramps. Absent, GROUND_NORMAL_Y everywhere (the synthetic
   * fields of the tests).
   */
  standNormalY?(x: number, z: number): number;
};

/** The steepest gradient a foot holds at a least normal `normalY`: the
 * inverse of the normal's rule, `sqrt(1 / normalY² − 1)`. */
export function walkableGradientFor(normalY: number): number {
  return Math.sqrt(1 / (normalY * normalY) - 1);
}

/**
 * Steepest gradient magnitude that still counts as walkable, derived from
 * GROUND_NORMAL_Y rather than restated alongside it.
 *
 * For a surface y = h(x, z) the upward normal is (−h_x, 1, −h_z)/L with
 * L = sqrt(1 + |∇h|²), so n_y = 1/L. Requiring n_y >= GROUND_NORMAL_Y is
 * therefore exactly |∇h| <= sqrt(1/GROUND_NORMAL_Y² − 1), which is this.
 */
export const MAX_WALKABLE_GRADIENT = walkableGradientFor(GROUND_NORMAL_Y);

/**
 * A ground field over one world seed.
 *
 * Pure in (seed, x, z) exactly as `elevationAt` is, which is what keeps peers
 * agreeing: there is no stored state to diverge and no generation order to
 * depend on. Two peers on the same seed resolve the same sweep against the same
 * surface without exchanging anything.
 */
export function createGroundField(seed: number, trail: TrailGraph | null = null, rock = true): GroundField {
  if (!rock) return bareGroundField(seed);
  return {
    heightAt(x, z) {
      // The rise alone: the layer's gradient is the normal's to read.
      const s = elevationSampleAt(seed, x, z);
      const rise = rockRiseAt(seed, x, z, s, trail);
      return rise === 0 ? s.h : s.h + rise;
    },
    normalAt(x, z, out) {
      const s = elevationSampleAt(seed, x, z);
      const rock = rockLayerAt(seed, x, z, s, trail);
      const dx = s.dx + rock.dx;
      const dz = s.dz + rock.dz;
      // Math.sqrt only — Math.hypot is banned in sim/ (architecture.test.ts):
      // it is implementation-approximated and would let two engines disagree.
      const inv = 1 / Math.sqrt(1 + dx * dx + dz * dz);
      out.x = -dx * inv;
      out.y = inv;
      out.z = -dz * inv;
    },
    standNormalY(x, z) {
      // The paint and the trail's clearance alone say whether the layer can stand here.
      return rockPaintAt(seed, x, z) === 0 || trailClearAt(trail, x, z) === 0 ? GROUND_NORMAL_Y : ROCK_STAND_NORMAL_Y;
    },
  };
}

/** The elevation field alone, without the walkable rock's layer: what the
 * ground was before 2026-10-13, kept for the cliff modules' gate tests,
 * whose modules stand on it (no module stands in the game, `CLIFF_DENSITY`
 * 0, and one that returned would have to stand on the layer). */
function bareGroundField(seed: number): GroundField {
  return {
    heightAt(x, z) {
      return elevationSampleAt(seed, x, z).h;
    },
    normalAt(x, z, out) {
      const s = elevationSampleAt(seed, x, z);
      const inv = 1 / Math.sqrt(1 + s.dx * s.dx + s.dz * s.dz);
      out.x = -s.dx * inv;
      out.y = inv;
      out.z = -s.dz * inv;
    },
  };
}
