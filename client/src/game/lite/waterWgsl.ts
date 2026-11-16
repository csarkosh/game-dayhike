/**
 * The water's shading in WGSL, statement for statement the game's GLSL: what
 * `shaders/water.fragment.fx`, `lakeRipples.fragment.fx`,
 * `lakeMirror.fragment.fx`, `waterLights.fragment.fx` and
 * `waterCompose.fragment.fx` say of a lake on the tiers that blend their
 * water over what lies under it (`waterPlugin.ts` on Babylon.js splices the
 * GLSL into its PBR material; `lakePlugin.ts` here hands these to Lite's).
 *
 * What is written differently, and why:
 *
 * - **Uniforms** are read as `material.<name>` under the GLSL's names; the
 *   ones every lake reads alike are the frame's (`frameBlock.ts`), and the
 *   plugin turns their reads to the block.
 * - **The bed's square and the skyline** are 32-bit floats read at the
 *   nearest texel, which WGSL does with `textureLoad` at a whole texel: the
 *   texel a nearest read of the GLSL's coordinate lands on, clamped at the
 *   picture's edges as its sampler clamps.
 * - **The first ripple octave** is the PBR material's own bump on
 *   Babylon.js, drifting by its texture's offset. Here the plugin reads the
 *   same picture at the mesh's coordinate plus the drift
 *   (`waterBumpOffset`) and turns it on the surface's frame itself
 *   (`WATER_BUMP_WGSL`): on a level surface whose coordinates run with the
 *   world's x and z, the frame Babylon.js derives from the screen's
 *   derivatives is those two axes, each turned over, for the side seen
 *   from above.
 * - **The environment's intensity** (`vLightingIntensity.z`) is drawn into
 *   the sky's capture here (`skyCapture.ts`), so the probe's radiance is
 *   read as it is and the skyline's shade arrives already scaled by it.
 * - **The split of the base colour** into albedo and F0 follows the plugin's
 *   statements, as Babylon.js's reflectivity block follows its plugin point:
 *   water's F0 is half the dielectric's, its grazing reflectance that half.
 * - **`mod`** is written out as `x - y * floor(x / y)`: WGSL's `%`
 *   truncates.
 *
 * Left out, as nothing here reads them: the cat's-paws' mask (`lakePaw`,
 * `lakePawThreshold`), which the GLSL keeps and no longer calls; the lens
 * of the second octave and the read of the frame behind the surface, which
 * belong to the tier that draws its water opaque; the mirror's read.
 *
 * Loads nothing.
 */
import { SKYLINE_TEXELS } from "../lakeSkyline.js";
import { WATER_F0 } from "../waterShading.js";

/** Babylon.js's dielectric F0 at an F0 factor of 1: water's F0 is the factor's share of it. */
const PBR_DIELECTRIC_F0 = 0.04;

/** The lake's varyings from the vertex stage: the bed's depth under the vertex and the vertex's view depth, metres. */
export const WATER_VERTEX_WGSL = "out.vBedDepth=bedDepth;out.vWaterViewDepth=out.clipPos.w;";

/** `water.fragment.fx`: the bed's depth, the horizon-safe normal and the skin. */
export const WATER_DEFS_WGSL = /* wgsl */ `
const WATER_F0:f32=0.02;
const WATER_F0_FACTOR:f32=${(WATER_F0 / PBR_DIELECTRIC_F0).toFixed(4)};
const WATER_HORIZON:f32=0.02;
const WATER_OCTAVE2_TILE:f32=3.0;
const WATER_OCTAVE2_WEIGHT:f32=0.333;
const WATER_OCTAVE2_DRIFT:f32=0.04;
const WATER_SKIN_DRIFT:f32=0.04;
fn waterBedDepth(xz:vec2<f32>,vBedDepth:f32)->f32{
  let local=(xz-material.waterBed.xy)*material.waterBed.z;
  let t=clamp(local,vec2<f32>(0.0),vec2<f32>(1.0))*material.waterBedTexels-0.5;
  let i=floor(t);
  let f=t-i;
  let last=vec2<i32>(i32(material.waterBedTexels)-1);
  let i0=clamp(vec2<i32>(i),vec2<i32>(0),last);
  let i1=clamp(vec2<i32>(i)+vec2<i32>(1),vec2<i32>(0),last);
  let h00=textureLoad(waterBedHeight,i0,0).r;
  let h10=textureLoad(waterBedHeight,vec2<i32>(i1.x,i0.y),0).r;
  let h01=textureLoad(waterBedHeight,vec2<i32>(i0.x,i1.y),0).r;
  let h11=textureLoad(waterBedHeight,i1,0).r;
  let h=mix(mix(h00,h10,f.x),mix(h01,h11,f.x),f.y);
  let outside=local.x<=0.0||local.y<=0.0||local.x>=1.0||local.y>=1.0;
  return select(material.waterLevel-h,vBedDepth,outside);
}
fn waterHorizonNormal(n:vec3<f32>,view:vec3<f32>)->vec3<f32>{
  var r=reflect(-view,n);
  if(r.y>=WATER_HORIZON){return n;}
  let xz=length(r.xz);
  if(xz<1.0e-4){
    r=vec3<f32>(0.0,1.0,0.0);
  }else{
    let k=sqrt(1.0-WATER_HORIZON*WATER_HORIZON)/xz;
    r=vec3<f32>(r.x*k,WATER_HORIZON,r.z*k);
  }
  return normalize(view+r);
}
fn waterSkinHash(p:vec2<f32>)->f32{
  var p3=fract(vec3<f32>(p.xyx)*0.1031);
  p3+=dot(p3,p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}
fn waterSkinNoise(p:vec2<f32>)->f32{
  let i=floor(p);
  let f=p-i;
  let u=f*f*(3.0-2.0*f);
  let a=waterSkinHash(i);
  let b=waterSkinHash(i+vec2<f32>(1.0,0.0));
  let c=waterSkinHash(i+vec2<f32>(0.0,1.0));
  let d=waterSkinHash(i+vec2<f32>(1.0,1.0));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
}
fn waterSkinMask(xz:vec2<f32>,depth:f32)->f32{
  if(material.waterSkin.x<=0.0){return 0.0;}
  let p=xz+material.waterSkin.y-material.waterWindTime*WATER_SKIN_DRIFT;
  let clear=0.4*(1.0-material.waterSkin.x);
  let drift=waterSkinNoise(p/9.0)*0.65+waterSkinNoise(p/3.0)*0.35;
  let duckweedAt=mix(0.55+clear,1.05,smoothstep(0.6,1.5,depth));
  let duckweed=smoothstep(duckweedAt,duckweedAt+0.06,drift);
  let algaeAt=mix(0.5+clear,1.05,smoothstep(0.15,0.4,depth));
  let algae=smoothstep(algaeAt,algaeAt+0.07,waterSkinNoise(p/1.6));
  return max(duckweed,algae);
}
fn waterSkinColour(xz:vec2<f32>,viewDepth:f32)->vec3<f32>{
  let p=xz+material.waterSkin.y-material.waterWindTime*WATER_SKIN_DRIFT;
  let frond=mix(waterSkinNoise(p*7.0),0.5,smoothstep(20.0,60.0,viewDepth));
  let duckweed=mix(vec3<f32>(0.16,0.26,0.05),vec3<f32>(0.24,0.34,0.07),frond);
  let algae=vec3<f32>(0.30,0.32,0.10);
  return mix(duckweed,algae,0.5*smoothstep(0.4,0.6,waterSkinNoise(p/1.6)));
}`;

/** `lakeRipples.fragment.fx`: the breeze's field, the octaves' amplitude, the rain's rings and the second octave. */
export const LAKE_RIPPLES_WGSL = /* wgsl */ `
const PAW_FEATURE_M:f32=10.0;
const PAW_SPEED:f32=1.5;
const PAW_LIFE_S:f32=6.0;
const PAW_GUST_FLOOR:f32=0.5;
const OCTAVE_FLOOR:f32=0.25;
const LAKE_BREEZE_GAIN:f32=0.7;
const LAKE_BREEZE_FLOOR:f32=0.4;
const LAKE_WARP_M:f32=1.5;
const LAKE_RING_REACH:f32=8.0;
const LAKE_RING_FADE_M:f32=2.0;
const LAKE_RING_CELL:f32=0.18;
const LAKE_RING_SPEED:f32=0.18;
const LAKE_RING_LAMBDA:f32=0.03;
const LAKE_RING_TAU:f32=0.3;
const LAKE_RING_AMP:f32=0.004;
const LAKE_RINGS_0:f32=35.0;
const LAKE_RINGS_1:f32=77.0;
const LAKE_RINGS_2:f32=150.0;
const LAKE_RAIN_MM_H:f32=4.0;
const LAKE_RING_FOLD:f32=512.0;
const LAKE_WIND_TURN:f32=0.005235987755982988;
const LAKE_TIME_WRAP:f32=300.0;
const LAKE_WIND_K1:f32=0.25132741228718347;
const LAKE_WIND_K2:f32=0.6981317007977318;
const LAKE_WIND_OMEGA1:f32=0.3769911184;
const LAKE_WIND_OMEGA2:f32=0.879645943;
const LAKE_WIND_RAGGED:f32=1.2;
const LAKE_WIND_RAGGED_CELL:f32=6.0;
fn lakeGust(p:vec2<f32>,t:f32,dir:vec2<f32>)->f32{
  let u=dir.x*p.x+dir.y*p.y;
  let c=floor(p/LAKE_WIND_RAGGED_CELL);
  let ragged=LAKE_WIND_RAGGED*(fract(c.x*0.618034+c.y*0.381966)-0.5);
  return sin(LAKE_WIND_K1*u-LAKE_WIND_OMEGA1*t+ragged)+0.5*sin(LAKE_WIND_K2*u-LAKE_WIND_OMEGA2*t+1.7*ragged);
}
fn lakeHash(i:f32,s:f32)->f32{
  var p=fract(vec3<f32>(i,s,i+s)*0.1031);
  p+=dot(p,p.yzx+33.33);
  return fract((p.x+p.y)*p.z);
}
fn lakePawDrift(dir:vec2<f32>,span:f32)->vec2<f32>{
  let c=cos(LAKE_WIND_TURN*span);
  let s=sin(LAKE_WIND_TURN*span);
  let k=PAW_SPEED/LAKE_WIND_TURN;
  return k*vec2<f32>(dir.y*(1.0-c)+dir.x*s,dir.x*(c-1.0)+dir.y*s);
}
fn lakePawNode(c:vec2<f32>,t:f32)->f32{
  return 0.5-0.5*cos(6.283185307179586*(t/PAW_LIFE_S+lakeHash(c.x,c.y)));
}
fn lakePawNoise(p:vec2<f32>,t:f32)->vec3<f32>{
  let i=floor(p);
  let f=p-i;
  let u=f*f*(3.0-2.0*f);
  let du=6.0*f*(1.0-f);
  let a=lakePawNode(i,t);
  let b=lakePawNode(i+vec2<f32>(1.0,0.0),t);
  let c=lakePawNode(i+vec2<f32>(0.0,1.0),t);
  let d=lakePawNode(i+vec2<f32>(1.0,1.0),t);
  let k=a-b-c+d;
  return vec3<f32>(a+(b-a)*u.x+(c-a)*u.y+k*u.x*u.y,du.x*(b-a+k*u.y),du.y*(c-a+k*u.x));
}
fn lakePawField(xz:vec2<f32>,t:f32,dir:vec2<f32>,span:f32)->vec3<f32>{
  let p=(xz-lakePawDrift(dir,span))/PAW_FEATURE_M;
  let a=lakePawNoise(p,t);
  let b=lakePawNoise(2.0*p+vec2<f32>(37.0,17.0),t);
  return vec3<f32>(a.x*2.0/3.0+b.x/3.0,(a.yz*2.0/3.0+b.yz*2.0/3.0)/PAW_FEATURE_M);
}
fn lakeBreeze(xz:vec2<f32>,t:f32,windDir:vec2<f32>,gust:f32)->vec3<f32>{
  var f=lakePawField(xz,t,windDir,t);
  if(t>LAKE_TIME_WRAP-PAW_LIFE_S){
    let b=lakePawField(xz,t,windDir,t-LAKE_TIME_WRAP);
    f=mix(f,b,smoothstep(LAKE_TIME_WRAP-PAW_LIFE_S,LAKE_TIME_WRAP,t));
  }
  let g=PAW_GUST_FLOOR+(1.0-PAW_GUST_FLOOR)*clamp(gust,0.0,1.0);
  return f*g;
}
fn octaveAmplitude(paw:f32,calm:f32)->f32{
  return max(smoothstep(0.0,1.0,paw),OCTAVE_FLOOR*(1.0-calm));
}
fn lakeLiveRings(rate:f32)->f32{
  let mmh=LAKE_RAIN_MM_H*rate;
  return LAKE_RINGS_0*clamp(mmh/0.5,0.0,1.0)+(LAKE_RINGS_1-LAKE_RINGS_0)*clamp((mmh-0.5)/0.5,0.0,1.0)+(LAKE_RINGS_2-LAKE_RINGS_1)*clamp(mmh-1.0,0.0,1.0);
}
fn lakeRingDh(r:f32,age:f32)->f32{
  let k=6.283185307179586/LAKE_RING_LAMBDA;
  let phase=k*(r-LAKE_RING_SPEED*age);
  let s=clamp((LAKE_RING_SPEED*age-r)/LAKE_RING_LAMBDA,0.0,1.0);
  let window=s*s*(3.0-2.0*s);
  let windowDr=-6.0*s*(1.0-s)/LAKE_RING_LAMBDA;
  return LAKE_RING_AMP*exp(-age/LAKE_RING_TAU)*(k*cos(phase)*window+sin(phase)*windowDr);
}
fn lakeRingHash(p:vec2<f32>)->vec2<f32>{
  var p3=fract(vec3<f32>(p.xyx)*vec3<f32>(0.1031,0.1030,0.0973));
  p3+=dot(p3,p3.yzx+33.33);
  return fract((p3.xx+p3.yz)*p3.zy);
}
fn lakeRainSlope(xz:vec2<f32>,t:f32,rate:f32,dist:f32)->vec2<f32>{
  let base=floor(xz/LAKE_RING_CELL);
  var sum=vec2<f32>(0.0);
  for(var j:i32=-1;j<=1;j++){
    for(var i:i32=-1;i<=1;i++){
      let cell=base+vec2<f32>(f32(i),f32(j));
      let h=cell-LAKE_RING_FOLD*floor(cell/LAKE_RING_FOLD);
      let s=t+lakeRingHash(h).x;
      let age=fract(s);
      let cycle=floor(s)-LAKE_TIME_WRAP*floor(floor(s)/LAKE_TIME_WRAP);
      let d=xz-(cell+lakeRingHash(h+cycle))*LAKE_RING_CELL;
      let r=length(d);
      sum-=d*(lakeRingDh(r,age)/max(r,1.0e-5));
    }
  }
  let scale=min(lakeLiveRings(rate)/LAKE_RINGS_1,1.0)*(1.0-smoothstep(LAKE_RING_REACH-LAKE_RING_FADE_M,LAKE_RING_REACH,dist));
  return sum*scale;
}
fn lakeRipple2(xz:vec2<f32>)->vec2<f32>{
  let uv=xz/WATER_OCTAVE2_TILE-material.waterWindTime*WATER_OCTAVE2_DRIFT;
  let n=textureSample(waterBump,waterBumpSampler,uv).xyz*2.0-1.0;
  return n.xy*WATER_OCTAVE2_WEIGHT;
}`;

/** `lakeMirror.fragment.fx`'s shore on the tiers with no mirror: the skyline's shade under the treeline. */
export const LAKE_SHORE_WGSL = /* wgsl */ `
const WATER_SKYLINE_TEXELS:i32=${SKYLINE_TEXELS};
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
}`;

/**
 * The first ripple octave: the bump's picture at the mesh's coordinate plus
 * the drift, turned on the level surface's frame (the world's x and z, each
 * turned over, as Babylon.js's frame comes out for the side seen from
 * above) and left as the lighting normal, as Babylon.js's PBR leaves it
 * before the plugin's point. The albedo is taken back to the base colour, which is
 * what that point is handed there.
 */
export const WATER_BUMP_WGSL = /* wgsl */ `
surfaceAlbedo=baseColor;
{
  let wMap=textureSample(waterBump,waterBumpSampler,input.uv+material.waterBumpOffset).xyz*2.0-1.0;
  N=normalize(vec3<f32>(-wMap.x,wMap.z,-wMap.y));
}`;

/** `waterLights.fragment.fx` on a lake whose water is blended: its depth, its ripples, its alpha and its skin. */
export const LAKE_LIGHTS_WGSL = /* wgsl */ `
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
let wF=WATER_F0+(1.0-WATER_F0)*pow(1.0-wNdV,5.0);
alpha=1.0-(1.0-wF)*exp(-2.0*wKdMean*wDepth);
let wSkin=waterSkinMask(input.worldPos.xz,wDepth);
if(material.waterSkin.x>0.0){
  surfaceAlbedo=mix(surfaceAlbedo,waterSkinColour(input.worldPos.xz,input.vWaterViewDepth),wSkin);
  alpha=mix(alpha,1.0,wSkin);
  N=normalize(mix(N,vec3<f32>(0.0,1.0,0.0),wSkin));
}`;

/**
 * What Babylon.js's own PBR does after the plugin's point and Lite's did
 * before it: the view's angle on the normal the statements above left, and
 * the split of the base colour by water's F0 (the dielectric's times the
 * material's F0 factor, which is also its grazing reflectance).
 */
export const WATER_SPLIT_WGSL = /* wgsl */ `
NdotVUnclamped=dot(N,V);
NdotV=abs(NdotVUnclamped)+0.0000001;
{
  let wF0=dielectricF0*WATER_F0_FACTOR;
  colorF0=vec3<f32>(wF0);
  colorF90=vec3<f32>(WATER_F0_FACTOR);
  surfaceAlbedo*=1.0-wF0;
}`;

/**
 * `waterCompose.fragment.fx` on a lake: the shore in place of the probe's
 * radiance, and the skin held matte; then the lit colour summed again from
 * its parts, which Lite has summed already by this point.
 */
export const LAKE_COMPOSE_WGSL = /* wgsl */ `
var wRadianceScaled=finalRadianceScaled;
if(material.waterMirrorWeight*material.waterCalmShare>0.0){
  let wProbeRadiance=environmentRadiance;
  let wShoreRay=reflect(-V,N);
  let wShore=mix(wProbeRadiance,waterSkylineRadiance(wShoreRay,wProbeRadiance),step(0.5,material.waterSkylineOn));
  let wMirrorW=material.waterMirrorWeight*(1.0-wPaw)*material.waterCalmShare;
  wRadianceScaled=mix(wRadianceScaled,wShore*colorSpecularEnvReflectance,wMirrorW);
}
wRadianceScaled*=1.0-wSkin;
let wSpecularScaled=finalSpecularScaled*(1.0-wSkin);
color=finalIrradiance+wRadianceScaled+wSpecularScaled+directDiffuse+emissive;`;
