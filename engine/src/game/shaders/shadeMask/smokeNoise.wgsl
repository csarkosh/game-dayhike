
const SHADE_SMOKE_SCALE:f32=${shadeSmokeScale};
const SHADE_SMOKE_RISE:f32=${shadeSmokeRise};
const SHADE_SMOKE_SOFT:f32=${shadeSmokeSoft};
const SHADE_SMOKE_FEET:f32=${shadeSmokeFeet};
fn shadeSmokeHash(q:vec3<f32>)->f32{
  var p=fract(q*0.3183099+vec3<f32>(0.1,0.2,0.3));
  p*=17.0;
  return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
}
fn shadeSmokeNoise(x:vec3<f32>)->f32{
  let i=floor(x);
  var f=fract(x);
  f=f*f*(3.0-2.0*f);
  let n000=shadeSmokeHash(i);
  let n100=shadeSmokeHash(i+vec3<f32>(1.0,0.0,0.0));
  let n010=shadeSmokeHash(i+vec3<f32>(0.0,1.0,0.0));
  let n110=shadeSmokeHash(i+vec3<f32>(1.0,1.0,0.0));
  let n001=shadeSmokeHash(i+vec3<f32>(0.0,0.0,1.0));
  let n101=shadeSmokeHash(i+vec3<f32>(1.0,0.0,1.0));
  let n011=shadeSmokeHash(i+vec3<f32>(0.0,1.0,1.0));
  let n111=shadeSmokeHash(i+vec3<f32>(1.0,1.0,1.0));
  return mix(mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y),mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y),f.z);
}
fn shadeSmokeFbm(p:vec3<f32>)->f32{
  var v=0.5*shadeSmokeNoise(p);
  v+=0.25*shadeSmokeNoise(p*2.03+vec3<f32>(1.7,9.2,4.4));
  v+=0.125*shadeSmokeNoise(p*4.01+vec3<f32>(8.3,2.8,6.1));
  return v/0.875;
}
fn shadeSmokeAt(world:vec3<f32>,seconds:f32)->vec3<f32>{
  return world*SHADE_SMOKE_SCALE+vec3<f32>(0.0,-seconds*SHADE_SMOKE_RISE*SHADE_SMOKE_SCALE,0.0);
}
