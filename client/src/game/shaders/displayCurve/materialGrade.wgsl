
fn gradeAt(at:vec2<f32>)->vec2<f32>{
  return vec2<f32>(at.x,1.0/${gradeBlock}.gradeScreen.y-at.y);
}
fn gradeVignette(color:vec3<f32>,at:vec2<f32>)->vec3<f32>{
  var viewportXY=gradeAt(at)*${gradeBlock}.gradeScreen.xy;
  viewportXY=viewportXY*2.0-1.0;
  let vignetteXY1=vec3<f32>(viewportXY*${gradeBlock}.gradeVignette1.xy+${gradeBlock}.gradeVignette1.zw,1.0);
  let vignetteTerm=dot(vignetteXY1,vignetteXY1);
  let vignette=pow(vignetteTerm,${gradeBlock}.gradeVignette2.w);
  let vignetteColor=${gradeBlock}.gradeVignette2.rgb;
  let vignetteColorMultiplier=mix(vignetteColor,vec3<f32>(1.0,1.0,1.0),vignette);
  return color*vignetteColorMultiplier;
}
fn gradeCurves(input:vec3<f32>)->vec3<f32>{
  var color=input;
  let luma=clamp(dot(color,vec3<f32>(0.2126,0.7152,0.0722)),0.0,1.0);
  let curveMix=clamp(vec2<f32>(luma*3.0-1.5,luma*-3.0+1.5),vec2<f32>(0.0),vec2<f32>(1.0));
  let colorCurve=${gradeBlock}.gradeCurveNeutral+curveMix.x*${gradeBlock}.gradeCurvePositive-curveMix.y*${gradeBlock}.gradeCurveNegative;
  color*=colorCurve.rgb;
  color=mix(vec3<f32>(luma),color,colorCurve.a);
  return color;
}
fn gradeRand(seed:vec2<f32>)->f32{
  return fract(sin(dot(seed.xy,vec2<f32>(12.9898,78.233)))*43758.5453);
}
fn gradeDither(color:vec3<f32>,at:vec2<f32>)->vec3<f32>{
  let rand=gradeRand(gradeAt(at)*${gradeBlock}.gradeScreen.xy);
  let dither=mix(-${gradeBlock}.gradeScreen.z,${gradeBlock}.gradeScreen.z,rand);
  return clamp(color+vec3<f32>(dither),vec3<f32>(0.0),vec3<f32>(1.0));
}
