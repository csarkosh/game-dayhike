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
export const DISPLAY_CURVE_WGSL = /* wgsl */ `
fn displayNeutral(input:vec3<f32>)->vec3<f32>{
  let x=min(input.r,min(input.g,input.b));
  let offset=select(0.04,x-6.25*x*x,x<0.08);
  let color=input-offset;
  let peak=max(color.r,max(color.g,color.b));
  let d=1.0-0.76;
  let newPeak=1.0-d*d/(peak+d-0.76);
  let g=1.0-1.0/(0.15*(peak-newPeak)+1.0);
  let compressed=mix(color*(newPeak/max(peak,1.0e-6)),vec3<f32>(newPeak),g);
  return select(compressed,color,peak<0.76);
}
fn displayContrastOf(c:vec3<f32>,contrast:f32)->vec3<f32>{
  let high=c*c*(3.0-2.0*c);
  let shaped=select(mix(c,high,contrast-1.0),mix(vec3<f32>(0.5),c,contrast),contrast<1.0);
  return max(shaped,vec3<f32>(0.0));
}
fn displayColour(linear:vec3<f32>,exposure:f32,contrast:f32)->vec3<f32>{
  var result=linear*exposure;
  result=displayNeutral(result);
  result=pow(max(result,vec3<f32>(0.0)),vec3<f32>(1.0/2.2));
  result=clamp(result,vec3<f32>(0.0),vec3<f32>(1.0));
  result=displayContrastOf(result,contrast);
  return clamp(result,vec3<f32>(0.0),vec3<f32>(1.0));
}`;

/** `displayColour` on a tier with a post chain: the linear colour, which the chain's grade exposes and shows. */
export const LINEAR_COLOUR_WGSL = /* wgsl */ `
fn displayColour(linear:vec3<f32>,exposure:f32,contrast:f32)->vec3<f32>{
  return linear;
}`;

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
export const MATERIAL_GRADE_WGSL = /* wgsl */ `
fn gradeAt(at:vec2<f32>)->vec2<f32>{
  return vec2<f32>(at.x,1.0/${GRADE_BLOCK}.gradeScreen.y-at.y);
}
fn gradeVignette(color:vec3<f32>,at:vec2<f32>)->vec3<f32>{
  var viewportXY=gradeAt(at)*${GRADE_BLOCK}.gradeScreen.xy;
  viewportXY=viewportXY*2.0-1.0;
  let vignetteXY1=vec3<f32>(viewportXY*${GRADE_BLOCK}.gradeVignette1.xy+${GRADE_BLOCK}.gradeVignette1.zw,1.0);
  let vignetteTerm=dot(vignetteXY1,vignetteXY1);
  let vignette=pow(vignetteTerm,${GRADE_BLOCK}.gradeVignette2.w);
  let vignetteColor=${GRADE_BLOCK}.gradeVignette2.rgb;
  let vignetteColorMultiplier=mix(vignetteColor,vec3<f32>(1.0,1.0,1.0),vignette);
  return color*vignetteColorMultiplier;
}
fn gradeCurves(input:vec3<f32>)->vec3<f32>{
  var color=input;
  let luma=clamp(dot(color,vec3<f32>(0.2126,0.7152,0.0722)),0.0,1.0);
  let curveMix=clamp(vec2<f32>(luma*3.0-1.5,luma*-3.0+1.5),vec2<f32>(0.0),vec2<f32>(1.0));
  let colorCurve=${GRADE_BLOCK}.gradeCurveNeutral+curveMix.x*${GRADE_BLOCK}.gradeCurvePositive-curveMix.y*${GRADE_BLOCK}.gradeCurveNegative;
  color*=colorCurve.rgb;
  color=mix(vec3<f32>(luma),color,colorCurve.a);
  return color;
}
fn gradeRand(seed:vec2<f32>)->f32{
  return fract(sin(dot(seed.xy,vec2<f32>(12.9898,78.233)))*43758.5453);
}
fn gradeDither(color:vec3<f32>,at:vec2<f32>)->vec3<f32>{
  let rand=gradeRand(gradeAt(at)*${GRADE_BLOCK}.gradeScreen.xy);
  let dither=mix(-${GRADE_BLOCK}.gradeScreen.z,${GRADE_BLOCK}.gradeScreen.z,rand);
  return clamp(color+vec3<f32>(dither),vec3<f32>(0.0),vec3<f32>(1.0));
}`;

/**
 * `displayShown(linear, exposure, contrast, at)`: a stage's linear colour as
 * the material path shows it at the fragment `at`: the vignette, the display
 * curve, the colour curves and the dither, in Babylon.js's order. With
 * `DISPLAY_CURVE_WGSL` and `MATERIAL_GRADE_WGSL` ahead of it.
 */
export const DISPLAY_SHOWN_WGSL = /* wgsl */ `
fn displayShown(linear:vec3<f32>,exposure:f32,contrast:f32,at:vec2<f32>)->vec3<f32>{
  return gradeDither(gradeCurves(displayColour(gradeVignette(linear,at),exposure,contrast)),at);
}`;

/**
 * `displayEncoded(color, contrast)`: a tone-mapped colour encoded for the
 * display and given its contrast, which Lite's PBR does at its own end
 * until its linear output is turned on, and never again in that page. A
 * tier with no chain drawn after one with a chain lays this on itself.
 * With `DISPLAY_CURVE_WGSL` ahead of it.
 */
export const DISPLAY_ENCODE_WGSL = /* wgsl */ `${DISPLAY_CURVE_WGSL}
fn displayEncoded(color:vec3<f32>,contrast:f32)->vec3<f32>{
  var result=pow(max(color,vec3<f32>(0.0)),vec3<f32>(1.0/2.2));
  result=clamp(result,vec3<f32>(0.0),vec3<f32>(1.0));
  return displayContrastOf(result,contrast);
}`;
