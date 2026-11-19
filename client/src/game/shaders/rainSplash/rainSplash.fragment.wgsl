
${varyings}
${displayCurve}
const SPLASH_E:f32=2.71828;
fn splashFogFactor(vFogDistance:vec3<f32>,fogDensity:f32)->f32{
  let fogDistance=length(vFogDistance);
  let fogCoeff=1.0/pow(SPLASH_E,fogDistance*fogDistance*fogDensity*fogDensity);
  return clamp(fogCoeff,0.0,1.0);
}
@fragment fn mainFragment(input:SplashOut)->@location(0)vec4<f32>{
  let u=shaderUniforms;
  let alpha=1.0;
  let emissiveColor=u.splashEmissive;
  let finalDiffuse=clamp(emissiveColor,vec3<f32>(0.0),vec3<f32>(1.0));
  var color=vec4<f32>(finalDiffuse,alpha);
  color=vec4<f32>(max(color.rgb,vec3<f32>(0.0)),color.a);
  let fog=splashFogFactor(input.fogDistance,u.splashFogDensity);
  color=vec4<f32>(mix(u.splashFogColour,color.rgb,fog),color.a);
  color=vec4<f32>(pow(color.rgb,vec3<f32>(2.2)),color.a);
  color=vec4<f32>(displayColour(color.rgb,u.splashExposure,u.splashContrast),color.a);
  let sD=length(input.splashUv-0.5)*2.0;
  let sRing=1.0-smoothstep(0.0,0.15,abs(sD-(0.3+0.7*input.splashPhase)));
  color.a*=sRing*input.splashAlpha;
  return color;
}
