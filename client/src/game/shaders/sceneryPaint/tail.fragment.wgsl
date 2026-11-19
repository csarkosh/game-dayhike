
${tailVaryings}
${displayCurve}
@fragment fn mainFragment(input:TailOut)->@location(0)vec4<f32>{
  let u=shaderUniforms;
  let alpha=1.0;
  let emissiveColor=u.tailColour;
  let finalDiffuse=clamp(emissiveColor,vec3<f32>(0.0),vec3<f32>(1.0));
  var color=vec4<f32>(finalDiffuse,alpha);
  color=vec4<f32>(max(color.rgb,vec3<f32>(0.0)),color.a);
  color=vec4<f32>(pow(color.rgb,vec3<f32>(2.2)),color.a);
  color=vec4<f32>(displayColour(color.rgb,u.tailExposure,u.tailContrast),color.a);
  return color;
}
