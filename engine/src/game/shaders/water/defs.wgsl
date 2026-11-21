
const WATER_F0:f32=0.02;
const WATER_F0_FACTOR:f32=${splitRatio};
const WATER_HORIZON:f32=0.02;
const WATER_OCTAVE2_TILE:f32=3.0;
const WATER_OCTAVE2_WEIGHT:f32=0.333;
const WATER_OCTAVE2_DRIFT:f32=0.04;
const WATER_SKIN_DRIFT:f32=0.04;
fn waterBedDepth(xz:vec2<f32>,vBedDepth:f32)->f32{
  let local=(xz-material.waterBed.xy)*material.waterBed.z;
  let t=clamp(local,vec2<f32>(0.0),vec2<f32>(1.0))*material.waterBedTexels-0.5;
  let i=floor(t);
  let f=t-i;
  let last=vec2<i32>(i32(material.waterBedTexels)-1);
  let i0=clamp(vec2<i32>(i),vec2<i32>(0),last);
  let i1=clamp(vec2<i32>(i)+vec2<i32>(1),vec2<i32>(0),last);
  let h00=textureLoad(waterBedHeight,i0,0).r;
  let h10=textureLoad(waterBedHeight,vec2<i32>(i1.x,i0.y),0).r;
  let h01=textureLoad(waterBedHeight,vec2<i32>(i0.x,i1.y),0).r;
  let h11=textureLoad(waterBedHeight,i1,0).r;
  let h=mix(mix(h00,h10,f.x),mix(h01,h11,f.x),f.y);
  let outside=local.x<=0.0||local.y<=0.0||local.x>=1.0||local.y>=1.0;
  return select(material.waterLevel-h,vBedDepth,outside);
}
fn waterHorizonNormal(n:vec3<f32>,view:vec3<f32>)->vec3<f32>{
  var r=reflect(-view,n);
  if(r.y>=WATER_HORIZON){return n;}
  let xz=length(r.xz);
  if(xz<1.0e-4){
    r=vec3<f32>(0.0,1.0,0.0);
  }else{
    let k=sqrt(1.0-WATER_HORIZON*WATER_HORIZON)/xz;
    r=vec3<f32>(r.x*k,WATER_HORIZON,r.z*k);
  }
  return normalize(view+r);
}
fn waterSkinHash(p:vec2<f32>)->f32{
  var p3=fract(vec3<f32>(p.xyx)*0.1031);
  p3+=dot(p3,p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}
fn waterSkinNoise(p:vec2<f32>)->f32{
  let i=floor(p);
  let f=p-i;
  let u=f*f*(3.0-2.0*f);
  let a=waterSkinHash(i);
  let b=waterSkinHash(i+vec2<f32>(1.0,0.0));
  let c=waterSkinHash(i+vec2<f32>(0.0,1.0));
  let d=waterSkinHash(i+vec2<f32>(1.0,1.0));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
fn waterSkinMask(xz:vec2<f32>,depth:f32)->f32{
  if(material.waterSkin.x<=0.0){return 0.0;}
  let p=xz+material.waterSkin.y-material.waterWindTime*WATER_SKIN_DRIFT;
  let clear=0.4*(1.0-material.waterSkin.x);
  let drift=waterSkinNoise(p/9.0)*0.65+waterSkinNoise(p/3.0)*0.35;
  let duckweedAt=mix(0.55+clear,1.05,smoothstep(0.6,1.5,depth));
  let duckweed=smoothstep(duckweedAt,duckweedAt+0.06,drift);
  let algaeAt=mix(0.5+clear,1.05,smoothstep(0.15,0.4,depth));
  let algae=smoothstep(algaeAt,algaeAt+0.07,waterSkinNoise(p/1.6));
  return max(duckweed,algae);
}
fn waterSkinColour(xz:vec2<f32>,viewDepth:f32)->vec3<f32>{
  let p=xz+material.waterSkin.y-material.waterWindTime*WATER_SKIN_DRIFT;
  let frond=mix(waterSkinNoise(p*7.0),0.5,smoothstep(20.0,60.0,viewDepth));
  let duckweed=mix(vec3<f32>(0.16,0.26,0.05),vec3<f32>(0.24,0.34,0.07),frond);
  let algae=vec3<f32>(0.30,0.32,0.10);
  return mix(duckweed,algae,0.5*smoothstep(0.4,0.6,waterSkinNoise(p/1.6)));
}
