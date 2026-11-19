/**
 * The terrain's material as plugins on Babylon Lite's PBR material: the
 * ground's layers blended by the mesh's weights, the road, the made
 * features and the trail painted over them, the far cover, and the wet
 * surfaces (`terrainUniforms.ts` has the numbers each is drawn with,
 * `terrainTables.ts` the float tables, `groundLayers.ts` the layers' images,
 * `terrainVertices.ts` what a terrain mesh carries a vertex).
 *
 * Where the WGSL goes into the material:
 *
 * - Lite has split the base colour into albedo and F0 before the blend
 *   runs, so the blend starts again from the base colour and a last plugin
 *   (`terrainSplitPlugin`, after the wet look) makes the split with the
 *   terrain's F0 and specular weight.
 * - The far cover's sun term is at Lite's point inside its own light loop.
 * - The layer weights, the cover and the vertex colour ride in the mesh's
 *   plugin vertex data, one interleaved buffer (`terrainVertexData`).
 * - Every texture shares one sampler: a stage has sixteen, and the material
 *   reads eleven textures. A layer's albedo is a one-layer array, and the
 *   three float tables are read with `textureLoad` at the texel a nearest
 *   read lands on.
 * - The WGSL samples inside branches and loops, so the fragment module turns
 *   the derivative-uniformity diagnostic off for itself.
 */
import type { MaterialPlugin, PluginUniformBlock, Texture2D, Texture2DArray } from "@babylonjs/lite";
import { finish, sliceDue, type Slices } from "../syncJobs.js";
import { emptyTerrainUniforms, layerMeanInverse, type TerrainUniforms } from "../terrainUniforms.js";
import { TERRAIN_ATTRIBUTES, TERRAIN_VERTEX_SIZES, type TerrainVertices } from "../terrainVertices.js";
import type { WetUniforms } from "../wetSurface.js";
import { frameReads, ownFields } from "./frameBlock.js";
import { uniformFields, writeUniforms, type UniformField } from "./pluginUniforms.js";
import { WET_FIELDS, WET_WEATHER, WET_WGSL, writeWetUniforms } from "./wetWgsl.js";

/**
 * The material's uniforms: the terrain's own by name (`terrainUniforms`),
 * and the material's albedo, which the road paint lays its colours over as
 * the blend lays the layers' (`terrainSurfaceUnder`: white, scaled by the
 * weather's wetness).
 */
export type TerrainMaterialUniforms = TerrainUniforms & { terrainAlbedo: [number, number, number] };

/** A record of the right shape, every component zero, the albedo white. */
export function emptyTerrainMaterialUniforms(): TerrainMaterialUniforms {
  return { ...emptyTerrainUniforms(), terrainAlbedo: [1, 1, 1] };
}

/** The plugin's fields: one a uniform, in the record's order. */
export const TERRAIN_FIELDS: readonly UniformField[] = uniformFields(emptyTerrainMaterialUniforms());

// The WGSL below reads each uniform by its bare name; in the material's
// buffer it is `material.<name>`.
const uniformNames = new RegExp(`\\b(${TERRAIN_FIELDS.map((field) => field.name).join("|")})\\b`, "g");
const bind = (wgsl: string): string => wgsl.replace(uniformNames, "material.$1");

/** The far cover's band, metres from the eye: the low tier's, and the other tiers' (`terrainCoverFor`). */
const FAR_BAND_LOW = "14.4,18.0";
const FAR_BAND_FULL = "24.0,30.0";

const DEFS = /* wgsl */ `
const HEX_LATTICE:f32=1.0;
const HEX_SHARPNESS:f32=8.0;
const HEX_SKEW:mat2x2<f32>=mat2x2<f32>(1.0,0.0,-0.57735027,1.15470054);
const HEX_UNSKEW:mat2x2<f32>=mat2x2<f32>(1.0,0.0,0.5,0.8660254);
const MACRO_WAVE:vec2<f32>=vec2<f32>(18.0,6.0);
const MACRO_WEIGHT:vec2<f32>=vec2<f32>(0.65,0.35);
const MACRO_SLOPE:f32=0.6;
const MACRO_LUSH:vec3<f32>=vec3<f32>(0.82,1.06,0.84);
const MACRO_DRY:vec3<f32>=vec3<f32>(1.18,0.98,0.7);
const HEX_TAU:f32=6.28318531;
// GLSL's mod: the sign of the divisor, where WGSL's % takes the dividend's.
fn gmod(x:f32,y:f32)->f32{return x-y*floor(x/y);}
fn gmod2(x:vec2<f32>,y:f32)->vec2<f32>{return x-y*floor(x/y);}
fn tex2(t:texture_2d_array<f32>,uv:vec2<f32>)->vec3<f32>{return textureSample(t,terrainSmp,uv,0).rgb;}
fn hexHash(v:vec2<f32>,salt:f32)->f32{return fract(sin(dot(v+salt,vec2<f32>(127.1,311.7)))*43758.5453);}
struct HexTri{v1:vec2<f32>,v2:vec2<f32>,v3:vec2<f32>,w:vec3<f32>}
fn hexTriangle(uv:vec2<f32>)->HexTri{
  let s=HEX_SKEW*(uv*HEX_LATTICE);
  let b=floor(s);
  let f=s-b;
  var r:HexTri;
  if(f.x+f.y<1.0){
    r.v1=b;r.v2=b+vec2<f32>(1.0,0.0);r.v3=b+vec2<f32>(0.0,1.0);
    r.w=vec3<f32>(1.0-f.x-f.y,f.x,f.y);
  }else{
    r.v1=b+vec2<f32>(1.0,1.0);r.v2=b+vec2<f32>(1.0,0.0);r.v3=b+vec2<f32>(0.0,1.0);
    r.w=vec3<f32>(f.x+f.y-1.0,1.0-f.y,1.0-f.x);
  }
  return r;
}
fn hexUv(uv:vec2<f32>,v:vec2<f32>)->vec2<f32>{
  let vp=(HEX_UNSKEW*v)/HEX_LATTICE;
  let a=hexHash(v,0.0)*HEX_TAU;
  let ca=cos(a);
  let sa=sin(a);
  let d=uv-vp;
  let o=vec2<f32>(hexHash(v,7.3),hexHash(v,13.1));
  return vec2<f32>(ca*d.x-sa*d.y,sa*d.x+ca*d.y)+o;
}
fn hexWeightsSharp(w:vec3<f32>)->vec3<f32>{
  let s=pow(max(w,vec3<f32>(0.0)),vec3<f32>(HEX_SHARPNESS));
  return s/max(s.x+s.y+s.z,1.0e-9);
}
struct Hex{u1:vec2<f32>,u2:vec2<f32>,u3:vec2<f32>,s:vec3<f32>}
fn hexSetup(uv:vec2<f32>)->Hex{
  let t=hexTriangle(uv);
  return Hex(hexUv(uv,t.v1),hexUv(uv,t.v2),hexUv(uv,t.v3),hexWeightsSharp(t.w));
}
fn hexFetch(tex:texture_2d_array<f32>,h:Hex,layer:i32,dx:vec2<f32>,dy:vec2<f32>)->vec3<f32>{
  return textureSampleGrad(tex,terrainSmp,h.u1,layer,dx,dy).rgb*h.s.x
    +textureSampleGrad(tex,terrainSmp,h.u2,layer,dx,dy).rgb*h.s.y
    +textureSampleGrad(tex,terrainSmp,h.u3,layer,dx,dy).rgb*h.s.z;
}
fn latticeHash(c:vec2<f32>)->f32{return fract(0.618034*c.x+0.381966*c.y+0.0113*c.x*c.y);}
fn macroValueNoise(p:vec2<f32>,wave:f32)->f32{
  let q=p/wave;
  let c=floor(q);
  let f=smoothstep(vec2<f32>(0.0),vec2<f32>(1.0),q-c);
  let a=latticeHash(c);
  let b=latticeHash(c+vec2<f32>(1.0,0.0));
  let d=latticeHash(c+vec2<f32>(0.0,1.0));
  let e=latticeHash(c+vec2<f32>(1.0,1.0));
  return mix(mix(a,b,f.x),mix(d,e,f.x),f.y);
}
fn macroTint(noise:f32,slope:f32)->vec3<f32>{
  let m=clamp(noise+MACRO_SLOPE*clamp(slope,0.0,1.0),0.0,1.0);
  return mix(MACRO_LUSH,MACRO_DRY,m);
}
fn horizonWeight(dist:f32)->f32{return terrainHorizon.z*smoothstep(terrainHorizon.x,terrainHorizon.y,dist);}

const FAR_COVER_BAND:vec2<f32>=vec2<f32>(FAR_BAND);
const FAR_SWARD_COVER:vec2<f32>=vec2<f32>(0.05,0.5);
const FAR_SWARD_MAX:f32=1.0;
const FAR_SWARD:vec3<f32>=vec3<f32>(0.106,0.122,0.058);
const FAR_LITTER:vec3<f32>=vec3<f32>(0.081,0.057,0.032);
const FAR_CANOPY_SHADE:f32=0.2832;
const FAR_CLUMP_CELL:vec2<f32>=vec2<f32>(1.0,3.0);
const FAR_CLUMP_WEIGHT:vec2<f32>=vec2<f32>(0.5,0.5);
const FAR_CLUMP_SALT:vec2<f32>=vec2<f32>(41.0,17.0);
const FAR_CLUMP_WRAP:f32=97.0;
const FAR_CLUMP_AO:f32=0.2;
const FAR_CLUMP_TILT:f32=1.0;
const FAR_COVER_TILT:f32=0.3;
const FAR_SPEC_CUT:f32=0.25;
const FAR_DRIFT_CELL:vec2<f32>=vec2<f32>(10.0,30.0);
const FAR_DRIFT_WEIGHT:vec2<f32>=vec2<f32>(0.5,0.5);
const FAR_DRIFT_SALT_A:vec2<f32>=vec2<f32>(7.0,23.0);
const FAR_DRIFT_SALT_B:vec2<f32>=vec2<f32>(61.0,5.0);
const FAR_DRIFT_AO:f32=0.55;
const FAR_DRIFT_TILT:f32=0.3;
const FAR_BARE_AO:f32=0.72;
const FAR_MACRO_CELL:vec2<f32>=vec2<f32>(60.0,220.0);
const FAR_MACRO_WEIGHT:vec2<f32>=vec2<f32>(0.6,0.4);
const FAR_MACRO_SALT_A:vec2<f32>=vec2<f32>(3.0,19.0);
const FAR_MACRO_SALT_B:vec2<f32>=vec2<f32>(29.0,47.0);
fn farCoverWeight(cover:f32,duff:f32,dist:f32)->f32{
  let key=clamp(cover+duff,0.0,1.0);
  return smoothstep(FAR_SWARD_COVER.x,FAR_SWARD_COVER.y,key)*smoothstep(FAR_COVER_BAND.x,FAR_COVER_BAND.y,dist);
}
fn farClumpOctave(p:vec2<f32>,cell:f32,salt:vec2<f32>)->vec3<f32>{
  let q=p/cell;
  let c=floor(q);
  let f=q-c;
  let u=f*f*(3.0-2.0*f);
  let du=6.0*f*(1.0-f);
  let c0=gmod2(c+salt,FAR_CLUMP_WRAP);
  let c1=gmod2(c+salt+1.0,FAR_CLUMP_WRAP);
  let a=latticeHash(c0);
  let b=latticeHash(vec2<f32>(c1.x,c0.y));
  let d=latticeHash(vec2<f32>(c0.x,c1.y));
  let e=latticeHash(c1);
  let k=a-b-d+e;
  let n=a+(b-a)*u.x+(d-a)*u.y+k*u.x*u.y;
  return vec3<f32>(du.x*(b-a+k*u.y),du.y*(d-a+k*u.x),n);
}
fn farClump(p:vec2<f32>,foot:f32)->vec3<f32>{
  let o1=farClumpOctave(p,FAR_CLUMP_CELL.x,vec2<f32>(0.0));
  let o2=farClumpOctave(p,FAR_CLUMP_CELL.y,FAR_CLUMP_SALT);
  let b1=FAR_CLUMP_WEIGHT.x*(1.0-smoothstep(0.5,1.0,foot/FAR_CLUMP_CELL.x));
  let b2=FAR_CLUMP_WEIGHT.y*(1.0-smoothstep(0.5,1.0,foot/FAR_CLUMP_CELL.y));
  return vec3<f32>(b1*o1.xy+b2*o2.xy,0.5+b1*(o1.z-0.5)+b2*(o2.z-0.5));
}
fn farDrift(p:vec2<f32>,foot:f32)->vec3<f32>{
  let o1=farClumpOctave(p,FAR_DRIFT_CELL.x,FAR_DRIFT_SALT_A);
  let o2=farClumpOctave(p,FAR_DRIFT_CELL.y,FAR_DRIFT_SALT_B);
  let b1=FAR_DRIFT_WEIGHT.x*(1.0-smoothstep(0.5,1.0,foot/FAR_DRIFT_CELL.x));
  let b2=FAR_DRIFT_WEIGHT.y*(1.0-smoothstep(0.5,1.0,foot/FAR_DRIFT_CELL.y));
  return vec3<f32>(b1*o1.xy+b2*o2.xy,0.5+b1*(o1.z-0.5)+b2*(o2.z-0.5));
}
fn farMacro(p:vec2<f32>)->f32{
  return FAR_MACRO_WEIGHT.x*farClumpOctave(p,FAR_MACRO_CELL.x,FAR_MACRO_SALT_A).z
    +FAR_MACRO_WEIGHT.y*farClumpOctave(p,FAR_MACRO_CELL.y,FAR_MACRO_SALT_B).z;
}

fn trailValueNoise1(u:f32,wave:f32)->f32{
  let q=u/wave;
  let c=floor(q);
  let f=smoothstep(0.0,1.0,q-c);
  return mix(latticeHash(vec2<f32>(c,0.0)),latticeHash(vec2<f32>(c+1.0,0.0)),f);
}
// One of the four layers the trail's ripple sums over.
fn trailRipple(xz:vec2<f32>,scale:f32,off:vec2<f32>,rank:f32,rate:f32,phase:f32)->vec2<f32>{
  let tRp=xz*scale+off;
  let tRc=floor(tRp);
  let tRh=gmod2(tRc,512.0);
  let tRcentre=vec2<f32>(latticeHash(tRh+vec2<f32>(37.0,0.0)),latticeHash(tRh+vec2<f32>(0.0,91.0)))*0.5+0.25;
  let tRd=tRp-tRc-tRcentre;
  let tRdist=length(tRd);
  let tRr=clamp(1.0-tRdist/0.25,0.0,1.0);
  let tRdir=tRd/max(tRdist,0.0001);
  let tRw=clamp(terrainRain*4.0-rank,0.0,1.0);
  let tRdrop=fract(latticeHash(tRh)+terrainTime*rate+phase);
  let tRt=tRdrop-1.0+tRr;
  let tRf=clamp(0.2+tRw*0.8-tRdrop,0.0,1.0);
  return tRdir*tRf*tRr*sin(clamp(tRt*9.0,0.0,3.0)*3.14159)*0.35;
}

fn featureShoreTexel(u:i32,v:i32)->f32{return textureLoad(featureTex,vec2<i32>(u,v+2),0).r;}
fn featureShoreAt(tile:f32,c:vec2<f32>,b:f32,xz:vec2<f32>)->f32{
  let loc=(xz-(c-vec2<f32>(b)))/(2.0*b);
  let p=clamp(loc*128.0,vec2<f32>(0.5),vec2<f32>(128.0-0.5))-vec2<f32>(0.5)
    +vec2<f32>(gmod(tile,2.0),floor(tile/2.0))*128.0;
  let i0=floor(p);
  let f=p-i0;
  let u0=i32(i0.x);
  let v0=i32(i0.y);
  let u1=min(u0+1,255);
  let v1=min(v0+1,255);
  let nearRow=mix(featureShoreTexel(u0,v0),featureShoreTexel(u1,v0),f.x);
  let farRow=mix(featureShoreTexel(u0,v1),featureShoreTexel(u1,v1),f.x);
  let inside=step(0.0,loc.x)*step(0.0,loc.y)*step(loc.x,1.0)*step(loc.y,1.0);
  return mix(-1000.0,mix(nearRow,farRow,f.y),inside);
}
fn featureWetInside(xz:vec2<f32>,centre:vec2<f32>,radius:f32,count:f32)->f32{
  var inside=1.0-smoothstep(radius+1.0,radius+3.0,length(xz-centre));
  var fLake=0.0;
  for(var fi=0;fi<8;fi++){
    if(f32(fi)>=count){break;}
    let f=textureLoad(featureTex,vec2<i32>(fi,0),0);
    if(f.w>2.5){
      if(length(f.xy-centre)<0.5){inside=1.0-smoothstep(1.0,3.0,-featureShoreAt(fLake,f.xy,f.z,xz));}
      fLake+=1.0;
    }
  }
  return inside;
}`;

const MAIN_BEGIN = `var terrainRough=1.0;var terrainF0=1.0;var terrainSpecW=1.0;var terrainFarW=0.0;var terrainPaintW=0.0;var terrainFarN=vec3<f32>(0.0,1.0,0.0);`;

/** One over a ground layer's mean colour, as the blend multiplies its texel by it: the layer's own colour made neutral (`LAYER_MEAN_RGB`). */
const meanInv = (layer: Parameters<typeof layerMeanInverse>[0]): string => `vec3<f32>(${layerMeanInverse(layer).join(",")})`;

// The blend. It starts from the material's colour times the vertex colour.
const BLEND = /* wgsl */ `
surfaceAlbedo=baseColor*input.vTerrainColor.rgb;
{
  let P=input.worldPos;
  let uvXZ=P.xz;
  let uvG=uvXZ*terrainTiling.x;
  let uvF=uvXZ*terrainTiling.y;
  let uvS=uvXZ*terrainTiling.z;
  let uvP=uvXZ*terrainTiling.w;
  let gdx=dpdx(uvG);let gdy=dpdy(uvG);
  let uvD=uvXZ*terrainDetail.x;
  let ddx=dpdx(uvD);let ddy=dpdy(uvD);
  var gh=Hex(vec2<f32>(0.0),vec2<f32>(0.0),vec2<f32>(0.0),vec3<f32>(0.0));
  if(input.vTerrainW.x>0.0){
    gh=hexSetup(uvG);
  }
  let rt=terrainRock2.x;
  let terrainN=normalize(input.worldNormal);
  let an=abs(terrainN);
  let bw=an/max(an.x+an.y+an.z,1e-4);
  let dist=distance(P,terrainEye);
  let strength=input.vTerrainW2.y*(1.0-smoothstep(terrainFade.x,terrainFade.y,dist));
  var w0=input.vTerrainW.x;var w1=input.vTerrainW.y;var w2=input.vTerrainW.z;var w3=input.vTerrainW.w;var w4=input.vTerrainW2.x;
  var rah0=vec3<f32>(0.5,1.0,0.5);var rah1=rah0;var rah2=rah0;var rah3=rah0;var rah4=rah0;
  var nrm=terrainN;
  var detailAo=1.0;
  var rpX=vec2<f32>(0.0);var rpY=vec2<f32>(0.0);var rpZ=vec2<f32>(0.0);
  if(strength>0.0&&w2>0.05){
    let rDir=normalize(P-terrainEye);
    let rDepth=0.03*rt;
    var rAb:vec2<f32>;var rUv:vec2<f32>;
    if(bw.y>=bw.x&&bw.y>=bw.z){rAb=rDir.xz;rUv=P.xz*rt;}
    else if(bw.x>=bw.z){rAb=rDir.yz;rUv=P.yz*rt;}
    else{rAb=rDir.xy;rUv=P.xy*rt;}
    let rStep=rAb*rDepth/12.0;
    let rLayer=1.0/12.0;
    var rOff=vec2<f32>(0.0);var rD=0.0;
    var rPrev=-(1.0-textureSample(terrainRAH,terrainSmp,rUv,2).b);
    var rHit=rPrev>=0.0;
    for(var ri=0;ri<12;ri++){
      if(rHit){break;}
      let nOff=rOff+rStep;let nD=rD+rLayer;
      let rDiff=nD-(1.0-textureSample(terrainRAH,terrainSmp,rUv+nOff,2).b);
      if(rDiff>=0.0){let rT=rPrev/(rPrev-rDiff);rOff=rOff+rStep*rT;rHit=true;}
      else{rOff=nOff;rD=nD;rPrev=rDiff;}
    }
    rOff*=strength;
    if(bw.y>=bw.x&&bw.y>=bw.z){rpY=rOff;}else if(bw.x>=bw.z){rpX=rOff;}else{rpZ=rOff;}
  }
  if(strength>0.0){
    if(input.vTerrainW.x>0.0){
      rah0=hexFetch(terrainRAH,gh,0,gdx,gdy);
    }else{
      rah0=textureSampleGrad(terrainRAH,terrainSmp,uvG,0,gdx,gdy).rgb;
    }
    rah1=textureSample(terrainRAH,terrainSmp,uvF,1).rgb;
    rah2=textureSample(terrainRAH,terrainSmp,P.xz*rt+rpY,2).rgb;
    rah3=textureSample(terrainRAH,terrainSmp,uvS,3).rgb;
    rah4=textureSample(terrainRAH,terrainSmp,uvP,4).rgb;
    let m=max(max(w0+rah0.b,w1+rah1.b),max(max(w2+rah2.b,w3+rah3.b),w4+rah4.b))-0.200;
    var b0=max(w0+rah0.b-m,0.0);var b1=max(w1+rah1.b-m,0.0);var b2=max(w2+rah2.b-m,0.0);
    var b3=max(w3+rah3.b-m,0.0);var b4=max(w4+rah4.b-m,0.0);
    let bs=max(b0+b1+b2+b3+b4,1e-4);
    b0=mix(w0,b0/bs,terrainReliefOn);b1=mix(w1,b1/bs,terrainReliefOn);b2=mix(w2,b2/bs,terrainReliefOn);
    b3=mix(w3,b3/bs,terrainReliefOn);b4=mix(w4,b4/bs,terrainReliefOn);
    w0=mix(w0,b0,strength);w1=mix(w1,b1,strength);w2=mix(w2,b2,strength);
    w3=mix(w3,b3,strength);w4=mix(w4,b4,strength);
    var t0:vec3<f32>;
    if(input.vTerrainW.x>0.0){
      t0=hexFetch(terrainNormals,gh,0,gdx,gdy)*2.0-1.0;
    }else{
      t0=textureSampleGrad(terrainNormals,terrainSmp,uvG,0,gdx,gdy).rgb*2.0-1.0;
    }
    let t1=textureSample(terrainNormals,terrainSmp,uvF,1).rgb*2.0-1.0;
    let t3=textureSample(terrainNormals,terrainSmp,uvS,3).rgb*2.0-1.0;
    let t4=textureSample(terrainNormals,terrainSmp,uvP,4).rgb*2.0-1.0;
    let tx=textureSample(terrainNormals,terrainSmp,P.yz*rt+rpX,2).rgb*2.0-1.0;
    let ty=textureSample(terrainNormals,terrainSmp,P.xz*rt+rpY,2).rgb*2.0-1.0;
    let tz=textureSample(terrainNormals,terrainSmp,P.xy*rt+rpZ,2).rgb*2.0-1.0;
    var planar=t0.xy*w0+t1.xy*w1+t3.xy*w3+t4.xy*w4;
    let detailStrength=w0*(1.0-smoothstep(terrainDetail.y,terrainDetail.z,dist))*terrainReliefOn;
    if(detailStrength>0.0){
      let dh=hexSetup(uvD);
      let tD=hexFetch(terrainNormals,dh,0,ddx,ddy)*2.0-1.0;
      planar+=tD.xy*terrainDetail.w*detailStrength;
      let hD=hexFetch(terrainRAH,dh,0,ddx,ddy).b;
      detailAo=mix(1.0,smoothstep(terrainDetail2.y,terrainDetail2.z,hD),terrainDetail2.x*detailStrength);
    }
    let pert=vec3<f32>(planar.x,0.0,planar.y)
      +w2*(vec3<f32>(0.0,tx.x,tx.y)*bw.x+vec3<f32>(ty.x,0.0,ty.y)*bw.y+vec3<f32>(tz.x,tz.y,0.0)*bw.z);
    nrm=normalize(terrainN+pert*strength);
    N=nrm;
  }
  var grassAlbedo:vec3<f32>;
  if(input.vTerrainW.x>0.0){grassAlbedo=hexFetch(terrainGrass,gh,0,gdx,gdy)*${meanInv("grass")};}
  else{grassAlbedo=textureSampleGrad(terrainGrass,terrainSmp,uvG,0,gdx,gdy).rgb*${meanInv("grass")};}
  let blended=
      grassAlbedo*w0
    +tex2(terrainFloor,uvF)*${meanInv("floor")}*w1
    +tex2(terrainSand,uvS)*${meanInv("sand")}*w3
    +tex2(terrainPebble,uvP)*${meanInv("pebble")}*w4
    +w2*${meanInv("rock")}*(
      tex2(terrainRock,P.yz*rt+rpX)*bw.x
    +tex2(terrainRock,P.xz*rt+rpY)*bw.y
    +tex2(terrainRock,P.xy*rt+rpZ)*bw.z);
  let ao=rah0.g*w0+rah1.g*w1+rah2.g*w2+rah3.g*w3+rah4.g*w4;
  surfaceAlbedo*=mix(vec3<f32>(1.0),blended,strength)*mix(1.0,ao/0.5,strength)*detailAo;
  let macroN18=macroValueNoise(P.xz,MACRO_WAVE.x);
  let macroN6=macroValueNoise(P.xz,MACRO_WAVE.y);
  let macroRgb=macroTint(MACRO_WEIGHT.x*macroN18+MACRO_WEIGHT.y*macroN6,1.0-terrainN.y);
  surfaceAlbedo*=mix(vec3<f32>(1.0),macroRgb,w0*terrainMacroOn*(1.0-smoothstep(terrainFade.x,terrainFade.y,dist)));
  surfaceAlbedo=mix(surfaceAlbedo,terrainTuft,w0*horizonWeight(dist));
  let swardW=terrainSward.w*smoothstep(terrainSwardBand.x,terrainSwardBand.y,input.vTerrainCover)*(1.0-smoothstep(terrainSwardBand.z,terrainSwardBand.w,dist));
  surfaceAlbedo=mix(surfaceAlbedo,terrainSward.rgb,swardW);
  let fcFw=fwidth(P.xz);
  let fcFoot=max(fcFw.x,fcFw.y);
  let fcFarMacro=macroTint(farMacro(P.xz),0.0);
  surfaceAlbedo*=mix(vec3<f32>(1.0),fcFarMacro,clamp(w0+input.vTerrainCover,0.0,1.0)*terrainMacroOn);
  let fcDrift=farDrift(P.xz,fcFoot);
  terrainFarW=farCoverWeight(input.vTerrainCover,input.vTerrainW2.z,dist);
  let fcBare=smoothstep(terrainFade.x,terrainFade.y,dist)*(1.0-terrainFarW);
  surfaceAlbedo*=mix(1.0,mix(FAR_BARE_AO,1.0,fcDrift.z),fcBare);
  if(terrainFarW>0.0){
    let fcClump=farClump(P.xz,fcFoot);
    let fcB18=1.0-smoothstep(0.5,1.0,fcFoot/MACRO_WAVE.x);
    let fcB6=1.0-smoothstep(0.5,1.0,fcFoot/MACRO_WAVE.y);
    let fcMacro=macroTint(MACRO_WEIGHT.x*mix(0.5,macroN18,fcB18)+MACRO_WEIGHT.y*mix(0.5,macroN6,fcB6),1.0-terrainN.y);
    let fcTarget=mix(FAR_SWARD,FAR_LITTER,clamp(input.vTerrainW2.z,0.0,1.0))
      *fcMacro
      *fcFarMacro
      *(1.0-FAR_CANOPY_SHADE*clamp(input.vTerrainW2.w,0.0,1.0))
      *mix(FAR_CLUMP_AO,1.0,fcClump.z)
      *mix(FAR_DRIFT_AO,1.0,fcDrift.z);
    surfaceAlbedo=mix(surfaceAlbedo,fcTarget,FAR_SWARD_MAX*terrainFarW);
    terrainFarN=normalize(N+vec3<f32>(-fcClump.x,0.0,-fcClump.y)*FAR_CLUMP_TILT+vec3<f32>(-fcDrift.x,0.0,-fcDrift.y)*FAR_DRIFT_TILT);
  }
  let rBase=terrainLayerRough.x*w0+terrainLayerRough.y*w1+terrainLayerRough.z*w2+terrainLayerRough.w*w3+terrainLayerRough2.x*w4;
  let rMap=rah0.r*w0+rah1.r*w1+rah2.r*w2+rah3.r*w3+rah4.r*w4;
  terrainRough=clamp(max(rBase*mix(1.0,rMap/0.5,strength),smoothstep(80.0,400.0,dist)),0.0,1.0);
  terrainF0=terrainLayerF0.x*w0+terrainLayerF0.y*w1+terrainLayerF0.z*w2+terrainLayerF0.w*w3+terrainLayerF02.x*w4;
}`;

// The road, its bands mirrored in `roadPaint.ts`. The centreline table is read at its texel.
const ROAD = /* wgsl */ `
{
  let P=input.worldPos;
  let rfi=(P.z-roadTable.x)/roadTable.y;
  let rfl=clamp(floor(rfi),0.0,roadTable.z-2.0);
  let rft=clamp(rfi-rfl,0.0,1.0);
  let rx0=textureLoad(roadCenter,vec2<i32>(i32(rfl),0),0).r;
  let rx1=textureLoad(roadCenter,vec2<i32>(i32(rfl)+1,0),0).r;
  let ru=P.x-mix(rx0,rx1,rft);
  let rau=abs(ru);
  let raa=fwidth(rau);
  if(rau<30.0){
    let rk=1.0-smoothstep(terrainFade.x,terrainFade.y,distance(P,terrainEye));
    let rGravelTex=mix(vec3<f32>(1.0),tex2(terrainPebble,P.xz*terrainTiling.w)/terrainRock2.y,rk);
    let rUv=vec2<f32>(ru,P.z)*roadTable.w;
    var rAsphaltTex=mix(vec3<f32>(1.0),tex2(roadAsphalt,rUv)/terrainRock2.y,rk);
    let rAsphaltN=textureSample(terrainNormals,terrainSmp,rUv,5).rgb*2.0-1.0;
    let rAsphaltRAH=textureSample(terrainRAH,terrainSmp,rUv,5).rgb;
    rAsphaltTex*=mix(1.0,rAsphaltRAH.g/0.5,rk);
    let rVerge=0.5*(1.0-smoothstep(5.5,30.0,rau));
    let rGravel=1.0-smoothstep(3.5,5.5,rau);
    let rE=max(0.4,raa);
    let rAsphalt=1.0-smoothstep(3.5-rE,3.5+rE,rau);
    let rRelief=rAsphalt*rk;
    N=normalize(mix(N,normalize(N+vec3<f32>(rAsphaltN.x,0.0,rAsphaltN.y)),rRelief));
    terrainRough=mix(terrainRough,clamp(terrainLayerRough2.y*mix(1.0,rAsphaltRAH.r/0.5,rk),0.0,1.0),rAsphalt);
    terrainF0=mix(terrainF0,terrainLayerF02.y,rAsphalt);
    terrainPaintW=max(terrainPaintW,rGravel);
    let rPhase=gmod(P.z,12.0);
    var rh=u32(i32(floor(P.z/12.0)))*2654435761u;
    rh^=rh>>15u;
    rh*=2246822519u;
    rh^=rh>>13u;
    let rKeep=f32(rh&65535u)/65536.0;
    let rOn=select(0.0,1.0,rPhase<3.0&&rKeep<0.65);
    let rLe=max(0.2,raa);
    let rLine=rOn*0.55*(1.0-smoothstep(0.15,0.15+rLe,rau));
    var rCol=mix(surfaceAlbedo,vec3<f32>(0.17,0.14,0.1)*terrainAlbedo,rVerge);
    rCol=mix(rCol,vec3<f32>(0.3,0.28,0.24)*rGravelTex*terrainAlbedo,rGravel);
    rCol=mix(rCol,vec3<f32>(0.14,0.14,0.15)*rAsphaltTex*terrainAlbedo,rAsphalt);
    rCol=mix(rCol,vec3<f32>(0.42,0.36,0.18)*terrainAlbedo,rLine);
    surfaceAlbedo=rCol;
  }
}`;

// The made features.
const FEATURE = /* wgsl */ `
{
  let P=input.worldPos;
  let fMeta=textureLoad(featureTex,vec2<i32>(0,1),0);
  let fRim=textureLoad(featureTex,vec2<i32>(1,1),0);
  var fLake=0.0;
  for(var fi=0;fi<8;fi++){
    if(f32(fi)>=featureInfo.x){break;}
    let f=textureLoad(featureTex,vec2<i32>(fi,0),0);
    let fd=length(P.xz-f.xy);
    if(f.w>1.5&&f.w<2.5){
      let meadow=1.0-smoothstep(f.z,f.z+fMeta.z,fd);
      surfaceAlbedo*=mix(vec3<f32>(1.0),vec3<f32>(0.92,1.06,0.82),meadow*0.5);
    }else if(f.w>2.5){
      let fShore=-featureShoreAt(fLake,f.xy,f.z,P.xz);
      fLake+=1.0;
      var shore=1.0-smoothstep(fMeta.w,fMeta.w+2.0,fShore);
      shore*=smoothstep(-1.0,0.0,fShore);
      surfaceAlbedo*=mix(vec3<f32>(1.0),vec3<f32>(0.85,0.78,0.70),shore*0.8);
    }else if(f.w>0.5){
      let above=smoothstep(fMeta.x-fMeta.y,fMeta.x,P.y);
      let fNear=1.0-smoothstep(f.z-fRim.x,f.z,fd);
      let crest=1.0-smoothstep(25.0,40.0,fd);
      let rock=max(above*fNear,crest);
      let fLum=dot(surfaceAlbedo,vec3<f32>(0.299,0.587,0.114));
      surfaceAlbedo=mix(surfaceAlbedo,vec3<f32>(fLum)*1.1,rock*0.85);
    }
  }
}`;

// The trail, its bands mirrored in `trailPaint.ts`. The segment table's three reads are at their texels: a cell's row
// (2 + cell row), the segment row 0, the arc-length row 1; the best segment is kept as its column.
const TRAIL = /* wgsl */ `
{
  let P=input.worldPos;
  let tb=clamp((P.xz-trailInfo.xy)*trailInfo.z,vec2<f32>(0.0),vec2<f32>(trailInfo.w-1.0));
  let tIdx=textureLoad(trailTable,vec2<i32>(i32(floor(tb.x)),2+i32(floor(tb.y))),0).xy;
  var tdBest=1.0e9;
  var tOff=vec2<f32>(0.0);
  var tcBest=0;
  var ttBest=0.0;
  for(var ti=0;ti<32;ti++){
    if(f32(ti)>=tIdx.y){break;}
    let tc=i32(tIdx.x+f32(ti)+0.5);
    let ts=textureLoad(trailTable,vec2<i32>(tc,0),0);
    let te=ts.zw-ts.xy;
    let tp=P.xz-ts.xy;
    let tl2=dot(te,te);
    let tt=select(0.0,clamp(dot(tp,te)/tl2,0.0,1.0),tl2>0.0);
    let tov=tp-tt*te;
    let td=length(tov);
    if(td<tdBest){tdBest=td;tOff=tov;tcBest=tc;ttBest=tt;}
  }
  let taa=fwidth(tdBest);
  if(tdBest<7.0+taa){
    let tk=1.0-smoothstep(terrainFade.x,terrainFade.y,distance(P,terrainEye));
    let tAway=select(vec2<f32>(0.0),tOff/tdBest,tdBest>1.0e-4);
    let tRise=dot(-input.worldNormal.xz,tAway)/max(input.worldNormal.y,1.0e-3);
    let tSoil=clamp(input.vTerrainW.x+input.vTerrainW.y,0.0,1.0);
    let tSnow=1.0-clamp(input.vTerrainW2.y,0.0,1.0);
    let tRow=textureLoad(trailTable,vec2<i32>(tcBest,1),0);
    let tU=mix(tRow.x,tRow.y,ttBest);
    let tWj=mix(tRow.z,tRow.w,ttBest);
    let tWear=0.6*trailValueNoise1(tU,12.0)+0.4*trailValueNoise1(tU,3.0);
    let tWidthK=mix(0.8,1.25,tWear)*tWj;
    let tDarkK=mix(0.85,1.1,tWear);
    let tEdgeN=0.6*macroValueNoise(P.xz,1.5)+0.4*macroValueNoise(P.xz,0.4);
    let tdN=tdBest+0.25*(2.0*tEdgeN-1.0);
    let tuvP=P.xz*terrainTiling.w;
    let tuvF=P.xz*terrainTiling.y;
    let tGravelTex=mix(vec3<f32>(1.0),tex2(terrainPebble,tuvP)/terrainRock2.y,tk);
    let tFloorTex=mix(vec3<f32>(1.0),tex2(terrainFloor,tuvF)/terrainRock2.y,tk);
    let tBedTex=mix(tGravelTex,tFloorTex,0.7);
    let tGravelN=textureSample(terrainNormals,terrainSmp,tuvP,4).rgb*2.0-1.0;
    let tGravelRAH=textureSample(terrainRAH,terrainSmp,tuvP,4).rgb;
    let tFloorN=textureSample(terrainNormals,terrainSmp,tuvF,1).rgb*2.0-1.0;
    let tFloorRAH=textureSample(terrainRAH,terrainSmp,tuvF,1).rgb;
    let tBedN=mix(tGravelN,tFloorN,0.7);
    let tBedRAH=mix(tGravelRAH,tFloorRAH,0.7);
    let tdB=tdN/tWidthK-0.3*(mix(0.5,tGravelRAH.b,tk)-0.5);
    let tE=max(0.08,taa/tWidthK);
    let tInCore=1.0-smoothstep(0.45,0.45+tE,tdB);
    let tInMargin=1.0-smoothstep(0.75,0.75+tE,tdB);
    let tCore=tInCore*(1.0-tSnow);
    let tTrample=(1.0-tInMargin)*(1.0-smoothstep(0.75,1.35,tdB))*tSoil*(1.0-tSnow);
    let tBank=smoothstep(0.0,0.15,tRise)*(1.0-smoothstep(0.75,7.0,tdN))*tSoil*(1.0-tSnow)*(1.0-tInMargin);
    let tBankBase=input.vTerrainColor.rgb;
    let tBedBase=mix(tBankBase,vec3<f32>(0.15,0.105,0.06),0.75*clamp(input.vTerrainW2.w,0.0,1.0));
    let tBenchBase=mix(vec3<f32>(1.0),tBedBase,0.8);
    var tCol=surfaceAlbedo*mix(vec3<f32>(1.0),vec3<f32>(0.9,0.88,0.8),tTrample);
    tCol=mix(tCol,tFloorTex*mix(1.0,tFloorRAH.g/0.5,tk)*tBankBase,tBank);
    N=normalize(mix(N,normalize(N+vec3<f32>(tFloorN.x,0.0,tFloorN.y)),tBank*tk));
    terrainRough=mix(terrainRough,clamp(terrainLayerRough.y*mix(1.0,tFloorRAH.r/0.5,tk),0.0,1.0),tBank);
    terrainF0=mix(terrainF0,terrainLayerF0.y,tBank);
    let tAo=mix(1.0,tBedRAH.g/0.5,tk);
    var tCoreCol=vec3<f32>(0.3,0.26,0.21)*tDarkK*tBedTex*0.24*tAo*tBenchBase;
    var tMarginCol=vec3<f32>(0.4,0.36,0.3)*tBedTex*0.47*tAo*tBenchBase;
    var tDrift=smoothstep(0.25,0.7,clamp(input.vTerrainW2.z,0.0,1.0));
    let tWash=smoothstep(0.55,0.8,macroValueNoise(P.xz,4.0));
    tDrift*=1.0-tWash;
    let tDriftCol=tFloorTex*vec3<f32>(0.8893440413949226,0.6225408289764459,0.35573761655796904)*mix(1.0,tFloorRAH.g/0.5,tk)*tBenchBase;
    let tWashDark=mix(0.4,0.75,clamp(input.vTerrainW2.w,0.0,1.0));
    let tWashCol=tFloorTex*tWashDark*mix(1.0,tFloorRAH.g/0.5,tk)*tBenchBase;
    tCoreCol=mix(mix(tCoreCol,tDriftCol,tDrift),tWashCol,tWash);
    tMarginCol=mix(mix(tMarginCol,tDriftCol,tDrift),tWashCol,tWash);
    let tPuddleLow=smoothstep(0.62,0.75,1.0-macroValueNoise(P.xz,6.0));
    let tPuddle=smoothstep(0.55,0.8,terrainWet)*tPuddleLow*tCore;
    tCoreCol*=1.0-0.35*terrainWet;
    tMarginCol*=1.0-0.35*0.5*terrainWet;
    tCoreCol=mix(tCoreCol,tCoreCol*0.5,tPuddle);
    let tPacked=surfaceAlbedo*vec3<f32>(0.86,0.88,0.94);
    let tOnBench=tInMargin;
    tCol=mix(tCol,mix(mix(tMarginCol,tCoreCol,tInCore),tPacked,tSnow),tOnBench);
    let tGravel=tOnBench*(1.0-tSnow);
    terrainPaintW=max(terrainPaintW,max(tBank,tOnBench));
    let tBenchN=normalize(N+vec3<f32>(tBedN.x,0.0,tBedN.y)*mix(1.0,0.5,tInCore)*(1.0-tDrift)*(1.0-tWash)+vec3<f32>(tFloorN.x,0.0,tFloorN.y)*tDrift);
    let tRamp=smoothstep(0.75,1.25,tdN/tWidthK);
    let tLip=4.0*tRamp*(1.0-tRamp)*(1.0-tSnow);
    let tLipN=normalize(N-vec3<f32>(tAway.x,0.0,tAway.y)*0.12*tLip);
    var tRipple=vec2<f32>(0.0);
    if(terrainRain>0.0){
      tRipple+=trailRipple(P.xz,2.5,vec2<f32>(0.0,0.0),0.0,1.0,0.0);
      tRipple+=trailRipple(P.xz,3.2,vec2<f32>(0.37,0.61),1.0,0.85,0.2);
      tRipple+=trailRipple(P.xz,2.1,vec2<f32>(0.71,0.13),2.0,0.93,0.45);
      tRipple+=trailRipple(P.xz,3.8,vec2<f32>(0.19,0.83),3.0,1.13,0.7);
    }
    let tPuddleN=normalize(vec3<f32>(tRipple.x*terrainRain,1.0,tRipple.y*terrainRain));
    N=normalize(mix(mix(tLipN,tBenchN,tGravel*tk),tPuddleN,tPuddle));
    var tRoughBench=clamp(terrainLayerRough2.x*mix(1.0,tBedRAH.r/0.5,tk),0.0,1.0);
    tRoughBench=mix(tRoughBench,clamp(terrainLayerRough.y*mix(1.0,tFloorRAH.r/0.5,tk),0.0,1.0),tDrift);
    tRoughBench=mix(tRoughBench,clamp(tRoughBench*1.15,0.0,1.0),tWash);
    tRoughBench*=1.0-0.5*terrainWet*mix(0.5,1.0,tInCore);
    terrainRough=mix(mix(terrainRough,tRoughBench,tGravel),0.05,tPuddle);
    terrainF0=mix(terrainF0,terrainLayerF02.x,tGravel);
    surfaceAlbedo=tCol;
  }
}`;

// The far cover's light, then what the PBR shader does after the point: its
// reflectivity block takes the material's roughness times terrainRough, and its geometry block reads the
// normal the blend left (Lite read N for these before the point).
const FAR_LIGHT = /* wgsl */ `
{
  terrainFarW*=1.0-terrainPaintW;
  if(terrainFarW>0.0){
    N=normalize(mix(N,terrainFarN,terrainFarW));
    var fcEye=vec3<f32>(V.x,0.0,V.z);
    fcEye/=max(length(fcEye),1e-4);
    terrainFarN=normalize(N+fcEye*FAR_COVER_TILT);
    terrainSpecW=1.0-FAR_SPEC_CUT*terrainFarW*(1.0-terrainWet);
  }
}
roughness=clamp(roughness*terrainRough,0.0,1.0);
NdotVUnclamped=dot(N,V);
NdotV=abs(NdotVUnclamped)+0.0000001;`;

// The far cover's answer to the sun: a directional light's Lambert term scaled by the far cover's. Lite
// has added the plain term by this point of its light loop, so the sum takes the difference.
const SUN = /* wgsl */ `{
  if(terrainFarW>0.0&&u32(lights.lights[lightIndex].vLightData.w)==1u){
    let tK=mix(1.0,min(clamp(dot(terrainFarN,pl.L),0.0,1.0)/max(pl.NdotL,0.0000001),2.0)*mix(0.8,1.0,clamp(dot(V,pl.L),0.0,1.0)),terrainFarW);
    directDiffuse+=surfaceAlbedo*(1.0/PI)*pl.NdotL*pl.color*pl.atten*material.directIntensity*sf*(tK-1.0);
  }
}`;

/** The textures the material reads: each layer's albedo a one-layer array,
 * the normals and the RAH maps six layers each (`groundLayers.ts`), and the
 * three float tables (`terrainTables.ts`). */
export type TerrainTextures = {
  grass: Texture2DArray; floor: Texture2DArray; rock: Texture2DArray; sand: Texture2DArray; pebble: Texture2DArray;
  normals: Texture2DArray; rah: Texture2DArray; asphalt: Texture2DArray;
  roadCenter: Texture2D; trailTable: Texture2D; featureTex: Texture2D;
};

/** The textures in the order the plugin declares and binds them, by the name
 * the WGSL reads each under: the eight arrays, then the three tables. */
export const TERRAIN_TEXTURE_ORDER: readonly (readonly [string, keyof TerrainTextures])[] = [
  ["terrainGrass", "grass"], ["terrainFloor", "floor"], ["terrainRock", "rock"], ["terrainSand", "sand"], ["terrainPebble", "pebble"],
  ["terrainNormals", "normals"], ["terrainRAH", "rah"], ["roadAsphalt", "asphalt"],
  ["roadCenter", "roadCenter"], ["trailTable", "trailTable"], ["featureTex", "featureTex"],
];
/** How many of them are layer arrays, sampled; the rest are tables, fetched. */
export const TERRAIN_ARRAY_TEXTURES = 8;

/** Which of the paints a world has: a world with no road, no trail or no
 * made features leaves that paint's statements out, and its table is never read. */
export type TerrainPaints = { road: boolean; trail: boolean; features: boolean };

/**
 * A terrain vertex's own data in the mesh's plugin vertex buffer: the two
 * weight sets, the cover and the vertex colour, by the name the vertex stage
 * reads each under, with the varying it is handed on as, how many floats it
 * is and the float it starts at.
 */
export const TERRAIN_VERTEX_LAYOUT = (() => {
  const parts = [
    { name: TERRAIN_ATTRIBUTES.weights, floats: TERRAIN_VERTEX_SIZES.weights, varying: "vTerrainW" },
    { name: TERRAIN_ATTRIBUTES.weights2, floats: TERRAIN_VERTEX_SIZES.weights2, varying: "vTerrainW2" },
    { name: TERRAIN_ATTRIBUTES.cover, floats: TERRAIN_VERTEX_SIZES.cover, varying: "vTerrainCover" },
    { name: "terrainColor", floats: TERRAIN_VERTEX_SIZES.colors, varying: "vTerrainColor" },
  ];
  let offset = 0;
  return parts.map((part) => {
    const at = offset;
    offset += part.floats;
    return { ...part, offset: at };
  });
})();

/** Floats a vertex in the plugin vertex buffer. */
export const TERRAIN_VERTEX_FLOATS = TERRAIN_VERTEX_LAYOUT.reduce((sum, part) => sum + part.floats, 0);

/**
 * A terrain mesh's plugin vertex data: `vertices`' weights, cover and colours
 * interleaved a vertex (`TERRAIN_VERTEX_LAYOUT`). Fills and returns `out`
 * where it is the right length, so a ring written again makes nothing; else
 * an array of its own.
 */
export function terrainVertexData(vertices: TerrainVertices, out?: Float32Array | null): Float32Array {
  return finish(terrainVertexDataSlices(vertices, out));
}

/** Vertices copied between two looks at the scheduler's clock (`sliceDue`): a few thousand floats. */
const COPY_BLOCK = 2048;

/** `terrainVertexData` in slices, each ended by the scheduler's clock between two blocks of vertices. */
export function* terrainVertexDataSlices(vertices: TerrainVertices, out?: Float32Array | null): Slices<Float32Array> {
  const count = vertices.positions.length / TERRAIN_VERTEX_SIZES.positions;
  const length = count * TERRAIN_VERTEX_FLOATS;
  const data = out !== undefined && out !== null && out.length === length ? out : new Float32Array(length);
  const sources = [vertices.weights, vertices.weights2, vertices.cover, vertices.colors];
  for (let p = 0; p < TERRAIN_VERTEX_LAYOUT.length; p++) {
    const part = TERRAIN_VERTEX_LAYOUT[p] as (typeof TERRAIN_VERTEX_LAYOUT)[number];
    const source = sources[p] as Float32Array;
    for (let i = 0; i < count; i++) {
      const from = i * part.floats;
      const to = i * TERRAIN_VERTEX_FLOATS + part.offset;
      for (let k = 0; k < part.floats; k++) data[to + k] = source[from + k] as number;
      if (i % COPY_BLOCK === COPY_BLOCK - 1 && sliceDue(COPY_UNITS)) yield;
    }
  }
  return data;
}

/** The units of work (`sliceDue`) a block of `COPY_BLOCK` vertices' copy counts: about as long as eight terrain samples. */
const COPY_UNITS = 8;

const VERTEX_FORMATS = ["float32", "float32x2", "float32x3", "float32x4"] as const;
const VERTEX_TYPES = ["f32", "vec2<f32>", "vec3<f32>", "vec4<f32>"] as const;

/**
 * The terrain's plugin: the blend, the paints `paints` names, and the far
 * cover with its sun term, drawn by `values` (one record, filled in place
 * every frame and read whenever the material's uniforms are written) and
 * `textures`. `farLow`: the far cover takes the low tier's band. Given
 * `shared`, the frame's block (`frameBlock.ts`), the whole record is read
 * from it and the material carries none: the terrain's two materials are
 * drawn by the one record, which the renderer writes to the block once a
 * frame.
 */
export function terrainPlugin(
  values: TerrainMaterialUniforms, textures: TerrainTextures, farLow: boolean, paints: TerrainPaints, shared?: PluginUniformBlock,
): MaterialPlugin {
  const before = BLEND + (paints.road ? ROAD : "") + (paints.features ? FEATURE : "") + (paints.trail ? TRAIL : "") + FAR_LIGHT;
  const reads = (wgsl: string): string => (shared === undefined ? wgsl : frameReads(wgsl));
  const stride = TERRAIN_VERTEX_FLOATS * 4;
  return {
    name: "TerrainTexture",
    priority: 200,
    defines: { farLow, road: paints.road, trail: paints.trail, features: paints.features },
    getFragmentDirectives: () => "diagnostic(off,derivative_uniformity);",
    getCustomCode: (stage) =>
      stage === "fragment"
        ? {
            CUSTOM_FRAGMENT_DEFINITIONS: reads(bind(DEFS.replace("FAR_BAND", farLow ? FAR_BAND_LOW : FAR_BAND_FULL))),
            CUSTOM_FRAGMENT_MAIN_BEGIN: reads(MAIN_BEGIN),
            CUSTOM_FRAGMENT_BEFORE_LIGHTS: reads(bind(before)),
            CUSTOM_FRAGMENT_LIGHT: reads(SUN),
          }
        : { CUSTOM_VERTEX_MAIN_END: TERRAIN_VERTEX_LAYOUT.map((part) => `out.${part.varying}=${part.name};`).join("") },
    getVertexAttributes: () =>
      TERRAIN_VERTEX_LAYOUT.map((part) => ({
        name: part.name,
        type: VERTEX_TYPES[part.floats - 1] as string,
        format: VERTEX_FORMATS[part.floats - 1] as GPUVertexFormat,
        stride,
        offset: part.offset * 4,
      })),
    getVaryings: () => TERRAIN_VERTEX_LAYOUT.map((part) => ({ name: part.varying, type: VERTEX_TYPES[part.floats - 1] as "f32" | "vec4<f32>" })),
    ...(shared === undefined ? { getUniforms: () => ({ ubo: [...TERRAIN_FIELDS] }) } : { getUniformBlocks: () => [shared] }),
    getSamplers: () =>
      TERRAIN_TEXTURE_ORDER.map(([name], i) => ({
        texture: name,
        ...(i === 0 ? { sampler: "terrainSmp" } : {}),
        ...(i < TERRAIN_ARRAY_TEXTURES ? { textureType: "texture_2d_array<f32>" as const } : { sampleType: "unfilterable-float" as const }),
      })),
    writeUbo(data, offsets) {
      if (shared === undefined) writeUniforms(data, offsets, values);
    },
    bindTextures(out) {
      TERRAIN_TEXTURE_ORDER.forEach(([, key], i) => out.push(i === 0 ? { texture: textures[key] } : { texture: textures[key], sampler: false }));
    },
    getActiveTextures(out) {
      for (const [, key] of TERRAIN_TEXTURE_ORDER) out.push(textures[key]);
    },
  };
}

// The wet look as the terrain draws it (a tarn's own shore decides what is inside it), then the wet
// look's roughness. After the terrain's statements at the point.
const WET_LIGHTS_TERRAIN = /* wgsl */ `let wetIn=featureWetInside(input.worldPos.xz,material.wetCentre,material.wetRadius,material.featureInfo.x);
let wetStill=wetBelow(input.worldPos.y,material.wetLine)*wetIn;
let wetCoveW=wetShore(input.worldPos.xz,input.worldPos.y)*wetIn;
let wetW=max(wetStill,wetCoveW.x);
let wetDamp=wetCoveW.y*(1.0-wetStill);
surfaceAlbedo*=mix(1.0,WET_ALBEDO,wetW)*mix(1.0,WET_DAMP_ALBEDO,wetDamp);
surfaceAlbedo=mix(surfaceAlbedo,vec3<f32>(1.0),wetCoveW.z*wetSpeckle(input.worldPos.xz,length(input.worldPos-scene.vEyePosition.xyz)));
let wetKdMean=(material.wetKd.r+material.wetKd.g+material.wetKd.b)/3.0;
let wetResidual=min(vec3<f32>(1.0),exp(-2.0*(material.wetKd-vec3<f32>(wetKdMean))*max(0.0,material.wetLevel-input.worldPos.y)*wetIn));
surfaceAlbedo*=mix(vec3<f32>(1.0),wetResidual,material.wetAttenuate);
roughness=mix(mix(roughness,min(roughness,WET_DAMP_ROUGHNESS),wetDamp),WET_ROUGHNESS,wetW);`;

/** The wet plugin's fields: one a uniform, in the record's order, the swash's table last. */
export const TERRAIN_WET_FIELDS: readonly UniformField[] = WET_FIELDS;

/**
 * The wet look on the terrain, drawn by `values` (`wetUniforms`: one record,
 * filled in place and read whenever the material's uniforms are written).
 * After the terrain's plugin, whose feature table it reads.
 */
export function terrainWetPlugin(values: WetUniforms, shared?: PluginUniformBlock): MaterialPlugin {
  const reads = (wgsl: string): string => (shared === undefined ? wgsl : frameReads(wgsl));
  // Given the frame's block, the wet line and the weather are read from it: the material's own is its cap.
  const fields = shared === undefined ? TERRAIN_WET_FIELDS : ownFields(TERRAIN_WET_FIELDS);
  return {
    name: "Wet",
    priority: 240,
    getCustomCode: (stage) =>
      stage === "fragment"
        ? {
          CUSTOM_FRAGMENT_DEFINITIONS: reads(WET_WGSL),
          CUSTOM_FRAGMENT_UPDATE_DIFFUSE: reads(WET_WEATHER),
          CUSTOM_FRAGMENT_BEFORE_LIGHTS: reads(WET_LIGHTS_TERRAIN),
        }
        : null,
    getUniforms: () => ({ ubo: [...fields] }),
    ...(shared === undefined ? {} : { getUniformBlocks: () => [shared] }),
    writeUbo(data, offsets) {
      if (shared === undefined) writeWetUniforms(data, offsets, values);
      else writeUniforms(data, offsets, { wetCap: values.wetCap });
    },
  };
}

/**
 * The split of the base colour into albedo and F0, with the terrain's F0 and
 * specular weight in it: Babylon's legacy energy conservation for a
 * dielectric. Last at the point, after the wet look's albedo.
 */
export function terrainSplitPlugin(): MaterialPlugin {
  return {
    name: "TerrainSplit",
    priority: 250,
    getCustomCode: (stage) =>
      stage === "fragment"
        ? { CUSTOM_FRAGMENT_BEFORE_LIGHTS: `{let tF0=dielectricF0*terrainF0*terrainSpecW;colorF0=vec3<f32>(tF0);colorF90=vec3<f32>(terrainSpecW);surfaceAlbedo*=1.0-tF0;}` }
        : null,
  };
}
