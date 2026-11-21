
@group(0)@binding(0)var<uniform>u:U;
@group(0)@binding(1)var postSampler:sampler;
@group(0)@binding(2)var sceneSampler:texture_2d<f32>;
@group(0)@binding(3)var paintSampler:texture_2d<f32>;
${compose}
const HALATION_THRESHOLD:f32=1.0;
const HALATION_CAP:f32=4.0;
const HALATION_TINT:vec3<f32>=vec3<f32>(1.0,0.45,0.2);
fn halationLuma(c:vec3<f32>)->f32{
  return dot(c,vec3<f32>(0.2126,0.7152,0.0722));
}
@fragment fn postFragment(input:PostVertex)->@location(0)vec4<f32>{
  let vUV=input.vUV;
  let h=0.5*u.texel;
  let frame=0.25*(composed(vUV+vec2<f32>(-h.x,-h.y))+composed(vUV+vec2<f32>(h.x,-h.y))+composed(vUV+vec2<f32>(-h.x,h.y))+composed(vUV+vec2<f32>(h.x,h.y)));
  let exposed=frame*u.exposure;
  let l=halationLuma(exposed);
  let over=clamp(l-HALATION_THRESHOLD,0.0,HALATION_CAP)/HALATION_CAP;
  return vec4<f32>(exposed/max(l,1.0e-4)*HALATION_TINT*over,1.0);
}
