
surfaceAlbedo=baseColor;
{
  let wMap=textureSample(waterBump,waterBumpSampler,input.uv+material.waterBumpOffset).xyz*2.0-1.0;
  N=normalize(vec3<f32>(-wMap.x,wMap.z,-wMap.y));
}
