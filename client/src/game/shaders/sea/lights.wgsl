
let wOceanDx=dpdx(input.vOceanXZ);
let wOceanDy=dpdy(input.vOceanXZ);
let wOceanKeep=oceanSwellPixelKeep(wOceanDx,wOceanDy);
let wOceanTilt=input.vOceanSwellA.xy*wOceanKeep;
let wOceanNormal=vec3<f32>(wOceanTilt.x,sqrt(max(1.0-dot(wOceanTilt,wOceanTilt),0.0)),wOceanTilt.y);
let wOceanHeight=input.vOceanSwellA.z;
let wOceanDrawn=input.vOceanSwellA.w*wOceanKeep*wOceanKeep;
let wOceanFoam=oceanFoamFromEnvelope(input.vOceanXZ,input.vOceanSwellB.xy,input.vOceanSwellB.z);
let wOceanLip=oceanLipFromEnvelope(input.vOceanXZ,input.vOceanSwellB.xy,input.vOceanSwellB.z);
let wOceanChop=oceanShelter(input.vOceanXZ,SHELTER_CHOP);
let wWindShare=oceanWindAmp(input.vOceanXZ);
let wWindAmp=wWindShare*(1.0-wOceanFoam.y)*wOceanChop;
${wind}
let wCoveShare=oceanCoveShare(input.vOceanXZ.y);
let wDry=step(1.0e-6,wCoveShare)*step(0.0,-(wOceanFoam.w+wSurfaceHeight));
let wBedRead=waterBedDepth(input.worldPos.xz,input.vBedDepth);
let wBedLow=min(wBedRead,wOceanFoam.w);
let wBedDepth=wBedLow+(wBedRead-wBedLow)*(1.0-wCoveShare)*(1.0-wDry);
var wDepth=wBedDepth+wSurfaceHeight+swashLift(input.vOceanXZ,wOceanFoam.w,wSurfaceHeight);
wDepth=select(0.0,wDepth,wDepth>OCEAN_REST_EPS);
if(wDepth<=0.0){discard;}
let wKdMean=(material.waterKd.r+material.waterKd.g+material.waterKd.b)/3.0;
${steep}
let wOceanExtra=${extra};
N=normalize(wOceanNormal+vec3<f32>(wOceanExtra.x,0.0,wOceanExtra.y)*wOceanNormal.y);
N=oceanLipNormal(N,wOceanLip);
let wOceanVar=oceanUndrawnVariance(material.oceanWindDir.z,wOceanChop,${variance});
if(material.waterRain>0.0){
  let wRs=waterRainSlope(input.worldPos.xz);
  N=normalize(N+vec3<f32>(wRs.x,0.0,wRs.y)*material.waterRain);
}
N=waterHorizonNormal(N,V);
let wNdV=clamp(dot(N,V),0.0,1.0);
let wF=WATER_F0+(1.0-WATER_F0)*pow(1.0-wNdV,5.0);${through}
let wOceanPixel=max(length(wOceanDx),length(wOceanDy));
let wFoamAge=oceanFoamLookAge(wOceanFoam.z);
let wOceanLace=oceanFoamCover(input.vOceanXZ,wOceanFoam.x,wOceanFoam.y,wOceanPixel);
var wOceanCap:f32;
${cap}
wOceanCap*=1.0-wOceanFoam.y;
var wFoam=max(wOceanLace,wOceanCap);
wFoam=oceanLipFoam(wFoam,wOceanLip,wOceanFoam.z);
let wFoamWhite=select(OCEAN_FOAM_ALBEDO,oceanFoamWhite(wFoamAge),wOceanLace>=wOceanCap);
surfaceAlbedo=mix(surfaceAlbedo,vec3<f32>(wFoamWhite),wFoam);${transmit}
alpha=mix(alpha,1.0,wFoam);
N=normalize(mix(N,vec3<f32>(0.0,1.0,0.0),wFoam));
roughness=min(sqrt(sqrt(2.0*wOceanVar)),1.0);
