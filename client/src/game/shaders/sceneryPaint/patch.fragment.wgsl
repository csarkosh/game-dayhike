
${patchVaryings}
${displayCurve}
const PATCH_E:f32=2.71828;
fn patchFogFactor(vFogDistance:vec3<f32>,fogDensity:f32)->f32{
  let fogDistance=length(vFogDistance);
  let fogCoeff=1.0/pow(PATCH_E,fogDistance*fogDistance*fogDensity*fogDensity);
  return clamp(fogCoeff,0.0,1.0);
}
@fragment fn mainFragment(input:PatchOut)->@location(0)vec4<f32>{
  let u=shaderUniforms;
  var alpha=u.patchDark;
  let opacityMap=textureSample(patchMap,patchMapSampler,input.uv);
  alpha*=opacityMap.a;
  let emissiveColor=vec3<f32>(0.0);
  let finalDiffuse=clamp(emissiveColor,vec3<f32>(0.0),vec3<f32>(1.0));
  var color=vec4<f32>(finalDiffuse,alpha);
  color=vec4<f32>(max(color.rgb,vec3<f32>(0.0)),color.a);
  let fog=patchFogFactor(input.fogDistance,u.patchFogDensity);
  color=vec4<f32>(mix(u.patchFogColour,color.rgb,fog),color.a);
  color=vec4<f32>(pow(color.rgb,vec3<f32>(2.2)),color.a);
  color=vec4<f32>(displayColour(color.rgb,u.patchExposure,u.patchContrast),color.a);
  return color;
}
