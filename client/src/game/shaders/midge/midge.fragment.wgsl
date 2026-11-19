
${data}
${varyings}
const MIDGE_DARK:f32=0.9;
const MIDGE_NEUTRAL_START:f32=0.76;
const MIDGE_NEUTRAL_DESATURATION:f32=0.15;
fn midgeNeutral(input:vec3<f32>)->vec3<f32>{
  var color=input;
  let x=min(color.r,min(color.g,color.b));
  let offset=mix(x-6.25*x*x,0.04,step(0.08,x));
  color-=offset;
  let peak=max(color.r,max(color.g,color.b));
  let top=max(peak,MIDGE_NEUTRAL_START);
  let k=1.0-MIDGE_NEUTRAL_START;
  let newPeak=1.0-k*k/(top+k-MIDGE_NEUTRAL_START);
  let g=1.0-1.0/(MIDGE_NEUTRAL_DESATURATION*(top-newPeak)+1.0);
  let compressed=mix(color*(newPeak/top),vec3<f32>(newPeak),g);
  return mix(color,compressed,step(MIDGE_NEUTRAL_START,peak));
}
fn midgeContrastOf(c:vec3<f32>,midgeContrast:f32)->vec3<f32>{
  let high=c*c*(3.0-2.0*c);
  let low=mix(vec3<f32>(0.5),c,midgeContrast);
  let raised=mix(c,high,midgeContrast-1.0);
  return max(mix(low,raised,step(1.0,midgeContrast)),vec3<f32>(0.0));
}
@fragment fn mainFragment(input:MidgeOut)->@location(0)vec4<f32>{
  let midgeSunLight=midgeData.sunLight.xyz;
  let midgeSkyGlow=midgeData.skyGlow.xyz;
  let midgeNight=midgeData.sun.w;
  let midgeSkyLuma=midgeData.sunLight.w;
  let midgeExposure=midgeData.tone.x;
  let midgeToneMap=midgeData.tone.y;
  let midgeContrast=midgeData.tone.z;
  let tent=clamp(1.0-abs(input.vCorner),vec2<f32>(0.0),vec2<f32>(1.0));
  let a=input.vAlpha*tent.x*tent.y;
  let day=1.0-midgeNight;
  let sunGlint=midgeSunLight*day*input.vSunGlint;
  let skyGlint=midgeSkyGlow*input.vSkyGlint;
  let speck=MIDGE_DARK*clamp(midgeSkyLuma,0.0,1.0);
  let light=(sunGlint+skyGlint)*a;
  var toned=midgeNeutral(light*midgeExposure);
  toned=clamp(pow(max(toned,vec3<f32>(0.0)),vec3<f32>(1.0/2.2)),vec3<f32>(0.0),vec3<f32>(1.0));
  toned=midgeContrastOf(toned,midgeContrast);
  return vec4<f32>(mix(light,toned,step(0.5,midgeToneMap)),speck*a);
}
