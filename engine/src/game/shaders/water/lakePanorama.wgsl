
const PANORAMA_HEIGHT_M:f32=${panoramaHeightM};
const PANORAMA_EYE_UP:f32=${panoramaEyeUp};
fn waterCylinderHit(origin:vec3<f32>,dir:vec3<f32>)->vec3<f32>{
  let o=origin.xz-material.waterLakeCentre.xz;
  let a=max(dot(dir.xz,dir.xz),1.0e-8);
  let b=dot(o,dir.xz);
  let c=dot(o,o)-material.waterLakeRadius*material.waterLakeRadius;
  let disc=b*b-a*c;
  let t=(sqrt(max(disc,0.0))-b)/a;
  return vec3<f32>(waterAzimuth(o+dir.xz*t),origin.y+dir.y*t-material.waterLakeCentre.y,step(0.0,disc)*step(0.0,t));
}
fn waterPanoramaRadiance(origin:vec3<f32>,dir:vec3<f32>,fallback:vec3<f32>)->vec3<f32>{
  let hit=waterCylinderHit(origin,dir);
  let shore=textureSampleLevel(waterPanorama,waterPanoramaSampler,vec2<f32>(hit.x,1.0-clamp(hit.y/PANORAMA_HEIGHT_M,0.0,1.0)),0.0);
  let skyline=waterSkylineAt(hit.x);
  let below=step(hit.y-PANORAMA_EYE_UP,material.waterLakeRadius*tan(skyline));
  return mix(fallback,shore.rgb,hit.z*below*shore.a);
}
