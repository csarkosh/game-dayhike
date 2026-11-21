
${varyings}
${displayCurve}
@fragment fn mainFragment(input:MoteOut)->@location(0)vec4<f32>{
  let u=shaderUniforms;
  let textureColor=textureSample(moteSprite,moteSpriteSampler,input.uv);
  var baseColor=textureColor*input.colour;
  baseColor=vec4<f32>(pow(baseColor.rgb,vec3<f32>(2.2)),baseColor.a);
  baseColor=vec4<f32>(displayColour(baseColor.rgb,u.moteExposure,u.moteContrast),baseColor.a);
  return baseColor;
}
