fn shadeHash(p:vec2<f32>)->f32{
  return fract(sin(dot(p,vec2<f32>(127.1,311.7)))*43758.5453);
}
fn shadeNoise(p:vec2<f32>)->f32{
  let i=floor(p);
  var f=fract(p);
  f=f*f*(3.0-2.0*f);
  let a=shadeHash(i);
  let b=shadeHash(i+vec2<f32>(1.0,0.0));
  let c=shadeHash(i+vec2<f32>(0.0,1.0));
  let d=shadeHash(i+vec2<f32>(1.0,1.0));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
