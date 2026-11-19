
@group(0)@binding(0)var<uniform>u:U;
@group(0)@binding(1)var postSampler:sampler;
@group(0)@binding(2)var textureSampler:texture_2d<f32>;
fn sharpenRead(uv:vec2<f32>)->vec4<f32>{return textureSampleLevel(textureSampler,postSampler,tx(uv),0.0);}
@fragment fn postFragment(input:PostVertex)->@location(0)vec4<f32>{
  let vUV=input.vUV;
  let c=sharpenRead(vUV);
  let n=sharpenRead(vUV+vec2<f32>(0.0,u.texel.y)).rgb;
  let s=sharpenRead(vUV-vec2<f32>(0.0,u.texel.y)).rgb;
  let e=sharpenRead(vUV+vec2<f32>(u.texel.x,0.0)).rgb;
  let w=sharpenRead(vUV-vec2<f32>(u.texel.x,0.0)).rgb;
  let lo=min(c.rgb,min(min(n,s),min(e,w)));
  let hi=max(c.rgb,max(max(n,s),max(e,w)));
  let lifted=c.rgb+u.sharpen*(c.rgb-0.25*(n+s+e+w));
  return vec4<f32>(clamp(lifted,lo,hi),c.a);
}
