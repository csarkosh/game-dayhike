/**
 * The shade veil's pure numbers (`lite/shadeVeil.ts` draws it): the
 * quad the material path draws over the frame after the scene, on the
 * tiers with no post chain, to darken it by the haunt's shades and the
 * stare as the grade pass does on the post tiers
 * (docs/rendering/2026-11-05-low-tier-material-path.md).
 *
 * The veil's fragment shader carries the grade's two blocks, the shades'
 * taps and the stare's crawl, as the grade's own pass runs them
 * (`lite/postWgsl.ts`): `lite/shadeVeil.test.ts` holds that, and finds each
 * block's first and last lines, named here, in the recorded
 * grade.fragment.glsl.
 */

/** The grade's shade block: from the taps' step to the frame darkened by the figure. */
export const GRADE_SHADE_BLOCK: readonly [string, string] = [
  "  vec2 shadeStep = vec2(shadeShape.x, shadeShape.x * shadeShape.z);",
  "  c *= 1.0 - min(1.0, shadeRGB.x * shadeShape.y + shadeReal * shadeMonster) * shadeKeep;",
];
/** The grade's stare block: from the open centre to the frame darkened by the closing. */
export const GRADE_STARE_BLOCK: readonly [string, string] = [
  "  vec2 sp = centred - stareShade.xy;",
  "  c *= 1.0 - 0.97 * dark;",
];
/**
 * The power the veil's factor is raised to before it multiplies the frame.
 * The material path's frame is sRGB-encoded by the time the veil draws,
 * where the grade multiplies in linear light; raising the factor to the
 * display's gamma makes a shade or a stare darken the picture by the same
 * amount as on the post tiers.
 */
export const VEIL_GAMMA = 1 / 2.2;
