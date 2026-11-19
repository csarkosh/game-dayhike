
${varyings}
${displayCurve}
const MIST_E:f32=2.71828;
fn mistFogFactor(vFogDistance:vec3<f32>,fogDensity:f32)->f32{
  let fogDistance=length(vFogDistance);
  let fogCoeff=1.0/pow(MIST_E,fogDistance*fogDistance*fogDensity*fogDensity);
  return clamp(fogCoeff,0.0,1.0);
}
@fragment fn mainFragment(input:MistOut)->@location(0)vec4<f32>{
  let u=shaderUniforms;
  var alpha=1.0;
  let opacityMap=textureSample(mistSprite,mistSpriteSampler,input.uv);
  alpha*=opacityMap.a;
  let emissiveColor=u.mistEmissive;
  let finalDiffuse=clamp(emissiveColor,vec3<f32>(0.0),vec3<f32>(1.0));
  var color=vec4<f32>(finalDiffuse,alpha);
  color=vec4<f32>(max(color.rgb,vec3<f32>(0.0)),color.a);
  let fog=mistFogFactor(input.fogDistance,u.mistFogDensity);
  color=vec4<f32>(mix(u.mistFogColour,color.rgb,fog),color.a);
  color=vec4<f32>(pow(color.rgb,vec3<f32>(2.2)),color.a);
  color=vec4<f32>(displayColour(color.rgb,u.mistExposure,u.mistContrast),color.a);
  color.a*=input.visibility;
  return color;
}
