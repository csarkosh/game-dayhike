/**
 * The lens the hike is seen through, as numbers: what the player's camera
 * projects with. A perspective projection of a left-handed world (x right,
 * y up, z forward), its field of view the vertical one, its aspect the
 * canvas's width over its height, between a near and a far plane.
 *
 * Babylon-free: `renderer.ts` gives the player's camera these.
 */

/** The game's own lens (rad, vertical). */
export const GAME_FOV = 1.4;

/** The near plane (m): close enough that the walker's own hands and the
 * ground at their feet are not clipped. */
export const LENS_NEAR = 0.05;

/** The far plane (m). It moves with the fog: the outermost clipmap ring's
 * corner is ~5.8 km out and the sky dome is 8 km across, so a nearer plane
 * clips the distant view away. */
export const LENS_FAR = 10000;

export type LensProjection = {
  /** The vertical field of view, radians. */
  fov: number;
  /** The near and the far plane, metres from the eye. */
  near: number;
  far: number;
};

/**
 * The projection's parameters for a frame: the game's own lens, or `fov`
 * where a film shot or the free camera brings its own. The planes are the
 * same through every lens.
 */
export function lensProjection(fov: number = GAME_FOV): LensProjection {
  return { fov, near: LENS_NEAR, far: LENS_FAR };
}
