
const OCEAN_BUMP_HS:f32=1.0;
const OCEAN_BUMP_MAX:f32=2.0;
fn oceanBumpScale(share:f32,breaking:f32,shelter:f32)->f32{
  return min(material.oceanWind.x*share*(1.0-breaking)*shelter/OCEAN_BUMP_HS,OCEAN_BUMP_MAX);
}
