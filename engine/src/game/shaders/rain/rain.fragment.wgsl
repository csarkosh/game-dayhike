
${varyings}
${displayCurve}
const RAIN_E:f32=2.71828;
fn rainFogFactor(vFogDistance:vec3<f32>,fogDensity:f32)->f32{
  let fogDistance=length(vFogDistance);
  let fogCoeff=1.0/pow(RAIN_E,fogDistance*fogDistance*fogDensity*fogDensity);
  return clamp(fogCoeff,0.0,1.0);
}
@fragment fn mainFragment(input:RainOut)->@location(0)vec4<f32>{
  let u=shaderUniforms;
  var alpha=1.0;
  let baseColor=textureSample(rainStreak,rainStreakSampler,input.uv);
  alpha*=baseColor.a;
  let emissiveColor=u.rainEmissive;
  let finalDiffuse=clamp(emissiveColor,vec3<f32>(0.0),vec3<f32>(1.0))*baseColor.rgb;
  var color=vec4<f32>(finalDiffuse,alpha);
  color=vec4<f32>(max(color.rgb,vec3<f32>(0.0)),color.a);
  let fog=rainFogFactor(input.fogDistance,u.rainFogDensity);
  color=vec4<f32>(mix(u.rainFogColour,color.rgb,fog),color.a);
  color=vec4<f32>(pow(color.rgb,vec3<f32>(2.2)),color.a);
  color=vec4<f32>(displayColour(color.rgb,u.rainExposure,u.rainContrast),color.a);
  color=vec4<f32>(mix(color.rgb,u.rainLampColour,input.rainLamp),color.a);
  color.a*=input.rainAlpha;
  return color;
}
