
struct VeilOut{@builtin(position)position:vec4<f32>,@location(0)vUV:vec2<f32>}
fn tx(uv:vec2<f32>)->vec2<f32>{return vec2<f32>(uv.x,1.0-uv.y);}
fn shadeRead(uv:vec2<f32>)->vec3<f32>{return textureSampleLevel(shadeSampler,shadeSamplerSampler,tx(uv),0.0).rgb;}
${shadeHelpers}
@fragment fn mainFragment(input:VeilOut)->@location(0)vec4<f32>{
  let u=shaderUniforms;
  let vUV=input.vUV;
  var c=vec3<f32>(1.0);
  let centred=(vUV-0.5)*2.0;
${shadeBlock}
${stareBlock}
  return vec4<f32>(pow(c,vec3<f32>(${veilGamma})),1.0);
}
