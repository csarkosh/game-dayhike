
@group(0)@binding(0)var<uniform>u:U;
@group(0)@binding(1)var postSampler:sampler;
@group(0)@binding(2)var textureSampler:texture_2d<f32>;
@fragment fn postFragment(input:PostVertex)->@location(0)vec4<f32>{
  let vUV=input.vUV;
  var blend=vec4<f32>(0.0);
${taps}
  return blend;
}
