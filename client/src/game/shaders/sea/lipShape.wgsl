
const LIP_COLUMNS:f32=512.0;
const LIP_HALF:f32=256.0;
const LIP_SLOTS:f32=2.0;
const LIP_PROFILE_VERTS:f32=24.0;
const LIP_KEYFRAMES:f32=8.0;
const LIP_THROW:f32=0.6;
const LIP_KEY_THROW:f32=4.0;
const LIP_EDGE_FIRST:f32=14.0;
const LIP_EDGE_LAST:f32=18.0;
const LIP_FOAM_ENVELOPE:f32=1000.0;
fn oceanLipKey(p:f32)->f32{
  let q=clamp(p,0.0,1.0);
  let early=q/LIP_THROW*LIP_KEY_THROW;
  let late=LIP_KEY_THROW+(q-LIP_THROW)/(1.0-LIP_THROW)*(LIP_KEYFRAMES-1.0-LIP_KEY_THROW);
  return mix(early,late,step(LIP_THROW,q));
}
fn oceanLipShape(p:f32,v:f32)->vec4<f32>{
  let k=oceanLipKey(p);
  let k0=min(floor(k),LIP_KEYFRAMES-2.0);
  let a=textureLoad(oceanLipProfile,vec2<i32>(i32(floor(v+0.5)),i32(k0)),0);
  let b=textureLoad(oceanLipProfile,vec2<i32>(i32(floor(v+0.5)),i32(k0)+1),0);
  return a+(b-a)*(k-k0);
}
struct OceanLipPlaced{place:vec3<f32>,xz:vec2<f32>,swell:vec4<f32>,env:vec4<f32>}
fn oceanLipPlace(strip:vec3<f32>)->OceanLipPlaced{
  let column=clamp(strip.x-material.oceanCove.x+LIP_HALF,0.0,LIP_COLUMNS-1.0);
  let slot=textureLoad(oceanLipState,vec2<i32>(i32(floor(column+0.5)),i32(floor(strip.y+0.5))),0);
  let size=slot.z*slot.w;
  let shape=oceanLipShape(slot.y,strip.z);
  let travel=material.oceanSwell.xy;
  var o:OceanLipPlaced;
  o.xz=vec2<f32>(oceanCoastAt(strip.x).coast.x+slot.x,strip.x)+travel*(shape.x*size);
  let displaced=oceanDisplace(o.xz);
  let sum=displaced.swell;
  let sumEnv=displaced.env;
  let disp=displaced.disp;
  let lift=shape.y*size;
  let t=shape.zw/max(length(shape.zw),1.0e-4);
  let sumNormal=vec3<f32>(sum.x,sqrt(max(1.0-dot(sum.xy,sum.xy),0.0)),sum.y);
  let turned=vec3<f32>(-t.y*travel.x,t.x,-t.y*travel.y)-vec3<f32>(0.0,1.0,0.0);
  let normal=normalize(sumNormal+turned*step(1.0e-6,size));
  o.swell=vec4<f32>(normal.x,normal.z,sum.z+lift,sum.w);
  let edge=step(LIP_EDGE_FIRST,strip.z)*step(strip.z,LIP_EDGE_LAST)*step(1.0e-6,size)*step(LIP_THROW,slot.y);
  o.env=mix(vec4<f32>(sumEnv,length(sumEnv),0.0),vec4<f32>(LIP_FOAM_ENVELOPE,0.0,LIP_FOAM_ENVELOPE,0.0),edge);
  o.place=vec3<f32>(o.xz.x,material.waterLevel,o.xz.y)+disp+vec3<f32>(0.0,lift,0.0);
  return o;
}
