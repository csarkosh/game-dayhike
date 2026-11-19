
const WATER_MIRROR_DEPTH:f32=${mirrorDepthFull};
const LAKE_MOTION_SMEAR_CAP:f32=${lakeMotionSmearCap};
fn waterMirrorUv(worldPos:vec3<f32>,slope:vec2<f32>,depth:f32,viewDepth:f32)->vec2<f32>{
  let clip=material.waterMirrorVP*vec4<f32>(worldPos,1.0);
  let uv0=clip.xy/clip.w*0.5+0.5;
  var uv=uv0+slope*material.waterMirrorK*min(depth/WATER_MIRROR_DEPTH,1.0)/max(viewDepth,1.0);
  uv.y=min(uv.y,uv0.y);
  return uv;
}
fn waterMirrorTap(uv:vec2<f32>)->vec4<f32>{
  let inside=step(vec2<f32>(0.0),uv)*step(uv,vec2<f32>(1.0));
  return textureSampleLevel(waterMirror,waterMirrorSampler,vec2<f32>(1.0)-clamp(uv,vec2<f32>(0.0),vec2<f32>(1.0)),0.0)*inside.x*inside.y;
}
fn waterMirrorSample(uv:vec2<f32>,smearPx:f32)->vec4<f32>{
  let stride=smearPx/(material.fadeRows*3.0);
  let sum=waterMirrorTap(uv)+waterMirrorTap(uv-vec2<f32>(0.0,stride))+waterMirrorTap(uv-vec2<f32>(0.0,2.0*stride))+waterMirrorTap(uv-vec2<f32>(0.0,3.0*stride));
  return vec4<f32>(sum.rgb/max(sum.a,1.0e-4),sum.a*0.25);
}
