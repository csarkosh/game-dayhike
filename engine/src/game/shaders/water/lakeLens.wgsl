
const LENS_STEP_M:f32=${lensStepM};
const CAUSTIC_GAIN:f32=${causticGain};
const CAUSTIC_MAX:f32=${causticMax};
const CAUSTIC_DEPTH_M:f32=${causticDepthM};
fn lakeLens(xz:vec2<f32>)->f32{
  let uv=xz/WATER_OCTAVE2_TILE-material.waterWindTime*WATER_OCTAVE2_DRIFT;
  let dx=vec2<f32>(LENS_STEP_M/WATER_OCTAVE2_TILE,0.0);
  let dz=vec2<f32>(0.0,LENS_STEP_M/WATER_OCTAVE2_TILE);
  let sxE=(textureSample(waterBump,waterBumpSampler,uv+dx).x*2.0-1.0)*WATER_OCTAVE2_WEIGHT;
  let sxW=(textureSample(waterBump,waterBumpSampler,uv-dx).x*2.0-1.0)*WATER_OCTAVE2_WEIGHT;
  let szN=(textureSample(waterBump,waterBumpSampler,uv+dz).y*2.0-1.0)*WATER_OCTAVE2_WEIGHT;
  let szS=(textureSample(waterBump,waterBumpSampler,uv-dz).y*2.0-1.0)*WATER_OCTAVE2_WEIGHT;
  return (sxE-sxW+szN-szS)/(2.0*LENS_STEP_M);
}
