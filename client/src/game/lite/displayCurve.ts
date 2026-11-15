/**
 * The material colour path in WGSL, for a stage of the hike's own on Babylon
 * Lite: what Babylon.js's image processing does to a linear colour in a
 * material on the low tier, in its order (the exposure, Khronos PBR Neutral,
 * the encode to the display, the contrast), which Lite's PBR ends with by
 * itself and a shader material must do for itself. The vignette, the colour
 * curves and the dither, which the low tier grades with in its materials on
 * Babylon.js, are drawn on Lite by no material.
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
