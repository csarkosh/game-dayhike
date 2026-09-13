import type { Vec3 } from "./types.js";
import { elevationSampleAt } from "./terrain.js";
import { GROUND_NORMAL_Y } from "./constants.js";

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
};

/**
 * Steepest gradient magnitude that still counts as walkable, derived from
 * GROUND_NORMAL_Y rather than restated alongside it.
 *
 * For a surface y = h(x, z) the upward normal is (−h_x, 1, −h_z)/L with
 * L = sqrt(1 + |∇h|²), so n_y = 1/L. Requiring n_y >= GROUND_NORMAL_Y is
 * therefore exactly |∇h| <= sqrt(1/GROUND_NORMAL_Y² − 1), which is this.
 */
export const MAX_WALKABLE_GRADIENT = Math.sqrt(
  1 / (GROUND_NORMAL_Y * GROUND_NORMAL_Y) - 1,
);

/**
 * A ground field over one world seed.
 *
 * Pure in (seed, x, z) exactly as `elevationAt` is, which is what keeps peers
 * agreeing: there is no stored state to diverge and no generation order to
 * depend on. Two peers on the same seed resolve the same sweep against the same
 * surface without exchanging anything.
 */
export function createGroundField(seed: number): GroundField {
  return {
    heightAt(x, z) {
      return elevationSampleAt(seed, x, z).h;
    },
    normalAt(x, z, out) {
      const s = elevationSampleAt(seed, x, z);
      // Math.sqrt only — Math.hypot is banned in sim/ (architecture.test.ts):
      // it is implementation-approximated and would let two engines disagree.
      const inv = 1 / Math.sqrt(1 + s.dx * s.dx + s.dz * s.dz);
      out.x = -s.dx * inv;
      out.y = inv;
      out.z = -s.dz * inv;
    },
  };
}
