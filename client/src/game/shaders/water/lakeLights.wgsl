
let wDepth=waterBedDepth(input.worldPos.xz,input.vBedDepth);
if(wDepth<=0.0){discard;}
let wKdMean=(material.waterKd.r+material.waterKd.g+material.waterKd.b)/3.0;
let wBreeze=lakeBreeze(input.worldPos.xz,material.waterLakeTime,material.waterWind,lakeGust(input.worldPos.xz,material.waterLakeTime,material.waterWind));
let wBreezeAt=clamp(wBreeze.x,0.0,1.0);
let wPaw=material.waterPawCover*LAKE_BREEZE_GAIN*mix(LAKE_BREEZE_FLOOR,1.0,wBreezeAt);
let wRippleXz=input.worldPos.xz+(2.0*wBreezeAt-1.0)*LAKE_WARP_M*vec2<f32>(-material.waterWind.y,material.waterWind.x);
let wOctave=octaveAmplitude(wPaw,material.waterCalmShare);
N=normalize(vec3<f32>(N.x*wOctave,N.y,N.z*wOctave));
if(material.waterOctaves>1.5){
  let wSlope=lakeRipple2(wRippleXz);
  N=normalize(N+vec3<f32>(wSlope.x,0.0,wSlope.y)*wOctave);
}
if(material.waterRain>0.0){
  let wRs=lakeRainSlope(input.worldPos.xz,material.waterLakeTime,material.waterRain,length(input.worldPos-scene.vEyePosition.xyz));
  N=normalize(N+vec3<f32>(wRs.x,0.0,wRs.y));
}
N=waterHorizonNormal(N,V);
let wNdV=clamp(dot(N,V),0.0,1.0);
let wF=WATER_F0+(1.0-WATER_F0)*pow(1.0-wNdV,5.0);${blend}
let wSkin=waterSkinMask(input.worldPos.xz,wDepth);
if(material.waterSkin.x>0.0){
  surfaceAlbedo=mix(surfaceAlbedo,waterSkinColour(input.worldPos.xz,input.vWaterViewDepth),wSkin);${skin}
  alpha=mix(alpha,1.0,wSkin);
  N=normalize(mix(N,vec3<f32>(0.0,1.0,0.0),wSkin));
}
