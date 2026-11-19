import curveSource from "../shaders/displayCurve/curve.wgsl?raw";
import linearColourSource from "../shaders/displayCurve/linearColour.wgsl?raw";
import materialGradeSource from "../shaders/displayCurve/materialGrade.wgsl?raw";
import shownSource from "../shaders/displayCurve/shown.wgsl?raw";
import encodeSource from "../shaders/displayCurve/encode.wgsl?raw";
import { fill, wgsl } from "../shaders/shaderText.js";

/**
 * The material colour path in WGSL, for a stage of the hike's own on Babylon
 * Lite: what Babylon.js's image processing does to a linear colour in a
 * material on the low tier, in its order (the exposure, Khronos PBR Neutral,
 * the encode to the display, the contrast), which Lite's PBR ends with by
 * itself and a shader material must do for itself, and the vignette, the
 * colour curves and the dither round it, which neither does by itself.
 *
 * On a tier with a post chain the colour is the chain's to grade: a stage
 * hands its linear colour on as it is (`onColourPath`), as Babylon.js's
 * materials do when their image processing is a post-process's. With no
 * chain the frame is graded in every material, as Babylon.js's image
 * processing grades it there: the vignette, the colour curves and the
 * dither beside the curve (`MATERIAL_GRADE_WGSL`), from the frame's block
 * (`materialGrade.ts` has the numbers).
 *
 * Loads nothing.
 */

/**
 * `displayColour(linear, exposure, contrast)`: a linear colour as the
 * display shows it. Babylon.js's `applyImageProcessing` with its tone map at
 * Khronos PBR Neutral, statement for statement.
 */
export const DISPLAY_CURVE_WGSL = wgsl(curveSource);

/** `displayColour` on a tier with a post chain: the linear colour, which the chain's grade exposes and shows. */
export const LINEAR_COLOUR_WGSL = wgsl(linearColourSource);

/**
 * `wgsl`, a stage that ends with `displayColour`, for the tier's colour
 * path: as it is on the material path, and with the linear colour handed on
 * where `linear` (a post chain grades the frame). The stage carries
 * `DISPLAY_CURVE_WGSL` whole; one that does not is refused.
 */
export function onColourPath(wgsl: string, linear: boolean): string {
  const at = wgsl.indexOf(DISPLAY_CURVE_WGSL);
  if (at < 0) throw new Error("the stage does not end with the display curve");
  if (linear) return wgsl.replace(DISPLAY_CURVE_WGSL, LINEAR_COLOUR_WGSL);
  // The material path's whole grade (`MATERIAL_GRADE_WGSL`): every `displayColour` the stage calls becomes
  // `displayShown` at the fragment's own place, which the stage's input names `position`.
  const shown = (text: string): string => text.replace(/\bdisplayColour\(([^()]*)\)/g, "displayShown($1,input.position.xy)");
  return `${shown(wgsl.slice(0, at))}${DISPLAY_CURVE_WGSL}${MATERIAL_GRADE_WGSL}${DISPLAY_SHOWN_WGSL}${shown(wgsl.slice(at + DISPLAY_CURVE_WGSL.length))}`;
}

/** The frame's block's names for the material path's grade (`materialGrade.ts`), which `frameBlock.ts` lays out. */
export const GRADE_BLOCK = "hikeFrame";

/**
 * The material path's grade in WGSL: what Babylon.js's image processing does
 * to a material's colour beside the display curve on the tiers with no post
 * chain, statement for statement, from the frame's block.
 *
 * - `gradeVignette(color, at)`: the vignette, multiplied into the linear
 *   colour ahead of the tone map. Babylon.js multiplies after the exposure,
 *   which is a factor too, so the two are the same either way round.
 * - `gradeCurves(color)`: the colour curves, after the contrast.
 * - `gradeDither(color, at)`: the dither, last, and the clamp.
 *
 * `at` is the fragment's place on the frame in pixels, its rows counted
 * down from the frame's top as WebGPU counts them; the dither draws its
 * number from a place whose rows count up from the frame's foot (Babylon.js
 * keeps a fragment's coordinates so), so
 * `gradeAt` turns the rows over first.
 */
export const MATERIAL_GRADE_WGSL = fill(wgsl(materialGradeSource), { gradeBlock: GRADE_BLOCK });

/**
 * `displayShown(linear, exposure, contrast, at)`: a stage's linear colour as
 * the material path shows it at the fragment `at`: the vignette, the display
 * curve, the colour curves and the dither, in Babylon.js's order. With
 * `DISPLAY_CURVE_WGSL` and `MATERIAL_GRADE_WGSL` ahead of it.
 */
export const DISPLAY_SHOWN_WGSL = wgsl(shownSource);

/**
 * `displayEncoded(color, contrast)`: a tone-mapped colour encoded for the
 * display and given its contrast, which Lite's PBR does at its own end
 * until its linear output is turned on, and never again in that page. A
 * tier with no chain drawn after one with a chain lays this on itself.
 * With `DISPLAY_CURVE_WGSL` ahead of it.
 */
export const DISPLAY_ENCODE_WGSL = fill(wgsl(encodeSource), { displayCurve: DISPLAY_CURVE_WGSL });
