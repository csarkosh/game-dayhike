
const WATER_SKYLINE_TEXELS:i32=${skylineTexels};
fn waterAzimuth(d:vec2<f32>)->f32{
  return fract(atan2(d.x,d.y+1.0e-20)*0.15915494309189535+1.0);
}
fn waterSkylineAt(u:f32)->f32{
  let x=clamp(i32(floor(u*f32(WATER_SKYLINE_TEXELS))),0,WATER_SKYLINE_TEXELS-1);
  return textureLoad(waterSkyline,vec2<i32>(x,0),0).r;
}
fn waterSkylineRadiance(dir:vec3<f32>,probeRadiance:vec3<f32>)->vec3<f32>{
  let skyline=waterSkylineAt(waterAzimuth(dir.xz));
  let below=step(dir.y,length(dir.xz)*tan(skyline));
  return mix(probeRadiance,material.waterShadeColour,below);
}
