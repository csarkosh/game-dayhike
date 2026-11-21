
var wTransmit=vec3<f32>(0.0);
{
  let wRaw=textureLoad(waterKeptDepth,vec2<i32>(input.clipPos.xy),0).r;
  let wSceneDepth=material.frameProjection[3].z/(wRaw-material.frameProjection[2].z);
  let wRayOn=wSceneDepth/max(input.vWaterViewDepth,1.0e-3)-1.0;
  let wBehind=max(0.0,min(wDepth,(scene.vEyePosition.y-input.worldPos.y)*wRayOn));
  let wOff=N.xz*WATER_REFRACT*min(max(wBehind,WATER_REFRACT_MIN),WATER_REFRACT_DEPTH)*smoothstep(0.0,0.02,wBehind);
  let wUv=input.clipPos.xy/vec2<f32>(textureDimensions(waterKept));
  var wBed=textureSampleLevel(waterKept,waterKeptSampler,wUv+vec2<f32>(wOff.x,-wOff.y),0.0).rgb;${lensBed}
  let wT=exp(-2.0*material.waterKd*wBehind);
  surfaceAlbedo*=1.0-wT;
  wTransmit=wBed*wT*(1.0-wF);
  alpha=1.0;
}
