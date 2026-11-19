
${varyings}
${displayCurve}
const SPRAY_E:f32=2.71828;
const SURF_SPRAY_OPACITY:f32=${surfSprayOpacity};
fn sprayFogFactor(vFogDistance:vec3<f32>,fogDensity:f32)->f32{
  let fogDistance=length(vFogDistance);
  let fogCoeff=1.0/pow(SPRAY_E,fogDistance*fogDistance*fogDensity*fogDensity);
  return clamp(fogCoeff,0.0,1.0);
}
fn sprayCover(vSprayUv:vec2<f32>,vSprayAlpha:f32)->f32{
  let d=length(vSprayUv-0.5)*2.0;
  return (1.0-smoothstep(0.0,1.0,d))*vSprayAlpha*SURF_SPRAY_OPACITY;
}
@fragment fn mainFragment(input:SprayOut)->@location(0)vec4<f32>{
  let u=shaderUniforms;
  let alpha=1.0;
  let emissiveColor=u.sprayEmissive;
  let finalDiffuse=clamp(emissiveColor,vec3<f32>(0.0),vec3<f32>(1.0));
  var color=vec4<f32>(finalDiffuse,alpha);
  color=vec4<f32>(max(color.rgb,vec3<f32>(0.0)),color.a);
  let fog=sprayFogFactor(input.fogDistance,u.sprayFogDensity);
  color=vec4<f32>(mix(u.sprayFogColour,color.rgb,fog),color.a);
  color=vec4<f32>(pow(color.rgb,vec3<f32>(2.2)),color.a);
  color=vec4<f32>(displayColour(color.rgb,u.sprayExposure,u.sprayContrast),color.a);
  color.a*=sprayCover(input.sprayUv,input.sprayAlpha);
  return color;
}
