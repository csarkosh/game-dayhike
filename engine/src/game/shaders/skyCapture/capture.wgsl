
struct Sky{sunDir:vec4<f32>,deckZenith:vec4<f32>,night:vec4<f32>,mistAir:vec4<f32>,disc:vec4<f32>,eye:vec4<f32>}
struct Face{normal:vec4<f32>,across:vec4<f32>,down:vec4<f32>}
@group(0)@binding(0)var<uniform>sky:Sky;
@group(0)@binding(1)var skyTable:texture_2d<f32>;
@group(0)@binding(2)var skyTableSampler:sampler;
@group(0)@binding(3)var<uniform>face:Face;
${skyRadiance}
const SKY_DOME_HALF:f32=${skyDomeHalf};
fn skyProbeDome(ray:vec3<f32>,eye:vec3<f32>)->vec3<f32>{
  let along=select(vec3<f32>(3.0e38),(eye+sign(ray)*SKY_DOME_HALF)/ray,abs(ray)>vec3<f32>(1.0e-8));
  let t=min(along.x,min(along.y,along.z));
  return normalize(ray*t-eye);
}
@vertex fn faceVertex(@builtin(vertex_index)i:u32)->@builtin(position)vec4<f32>{
  var corners=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
  return vec4<f32>(corners[i],0.0,1.0);
}
@fragment fn faceFragment(@builtin(position)at:vec4<f32>)->@location(0)vec4<f32>{
  let a=2.0*at.x/${skyProbeSize}-1.0;
  let b=2.0*at.y/${skyProbeSize}-1.0;
  let d=skyProbeDome(normalize(face.normal.xyz+face.across.xyz*a+face.down.xyz*b),sky.eye.xyz);
  let radiance=skyRadiance(d,sky.sunDir.xyz,sky.sunDir.w,sky.deckZenith.w,sky.deckZenith.xyz,sky.night.xyz,sky.disc.xyz,sky.mistAir.xyz,sky.night.w,1.0);
  return vec4<f32>(radiance*sky.mistAir.w,1.0);
}
