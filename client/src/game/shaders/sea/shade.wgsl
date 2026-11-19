
const WATER_COX_MUNK_A:f32=0.003;
const WATER_COX_MUNK_B:f32=0.00512;
const OCEAN_SLOPE_VAR_FLOOR:f32=0.0015;
fn oceanUndrawnVariance(u10:f32,shelter:f32,drawn:f32)->f32{
  return max((WATER_COX_MUNK_A+WATER_COX_MUNK_B*u10)*shelter-drawn,OCEAN_SLOPE_VAR_FLOOR);
}
const OCEAN_FOAM_ALBEDO:f32=0.4;
const OCEAN_FOAM_ALBEDO_OLD:f32=0.06;
const OCEAN_FOAM_FADE:f32=4.7;
const OCEAN_INNER_COVER:f32=0.6;
const OCEAN_LACE_TILE:f32=3.0;
const OCEAN_LACE_DRIFT:f32=0.4;
const OCEAN_LACE_SOFT:f32=0.06;
const OCEAN_LACE_WEIGHT:f32=0.65;
const OCEAN_LACE_FINE:f32=0.37;
const OCEAN_LACE_FINE_SHIFT:f32=19.0;
const OCEAN_LACE_FIT_A:f32=0.4334;
const OCEAN_LACE_FIT_B:f32=-0.1923;
const OCEAN_LACE_FIT_C:f32=0.1369;
const OCEAN_LACE_FIT_D:f32=0.5144;
const OCEAN_LACE_FIT_E:f32=0.1083;
const OCEAN_LACE_ONSET:f32=0.01;
const OCEAN_DETAIL_LO:f32=0.1;
const OCEAN_DETAIL_HI:f32=0.4;
const OCEAN_CAP_CELL:f32=5.0;
const OCEAN_CAP_PERIOD:f32=5.0;
const OCEAN_CAP_RADIUS:f32=0.3;
const OCEAN_CAP_INSET:f32=0.3;
const OCEAN_CAP_DRIFT:f32=2.0;
const OCEAN_CAP_SHARE:f32=0.1028;
const OCEAN_CAP_CYCLES:f32=97.0;
const OCEAN_CAP_SOFT:f32=0.4;
fn oceanLace(p:vec2<f32>)->f32{
  let q=p+material.waterSkin.y-material.oceanSwell.xy*(OCEAN_LACE_DRIFT*material.seaTime);
  let a=1.0-abs(2.0*waterSkinNoise(q/OCEAN_LACE_TILE)-1.0);
  let b=1.0-abs(2.0*waterSkinNoise(q/(OCEAN_LACE_FINE*OCEAN_LACE_TILE)+OCEAN_LACE_FINE_SHIFT)-1.0);
  return OCEAN_LACE_WEIGHT*a+(1.0-OCEAN_LACE_WEIGHT)*b;
}
fn oceanFoamLookAge(foamAge:f32)->f32{
  let ahead=OCEAN_TWO_PI-foamAge*(OCEAN_TWO_PI/material.oceanSwell.z);
  return foamAge*smoothstep(0.0,OCEAN_ROLL_WIDTH,ahead);
}
fn oceanFoamShare(foam:f32,breaking:f32)->f32{
  return max(foam,breaking*OCEAN_INNER_COVER);
}
fn oceanLaceLevel(share:f32)->f32{
  let c=clamp(share,0.0,1.0);
  let s=sqrt(c);
  let p=1.0-sqrt(sqrt(1.0-c));
  return 1.0-s*(OCEAN_LACE_FIT_A+s*(OCEAN_LACE_FIT_B+s*OCEAN_LACE_FIT_C))-p*(OCEAN_LACE_FIT_D+p*OCEAN_LACE_FIT_E);
}
fn oceanFoamCover(p:vec2<f32>,foam:f32,breaking:f32,pixel:f32)->f32{
  let share=oceanFoamShare(foam,breaking);
  let level=oceanLaceLevel(share);
  let lace=smoothstep(level-0.5*OCEAN_LACE_SOFT,level+0.5*OCEAN_LACE_SOFT,oceanLace(p))*smoothstep(0.0,OCEAN_LACE_ONSET,share);
  return mix(lace,share,smoothstep(OCEAN_DETAIL_LO,OCEAN_DETAIL_HI,pixel/OCEAN_LACE_TILE));
}
fn oceanFoamWhite(lookAge:f32)->f32{
  return mix(OCEAN_FOAM_ALBEDO_OLD,OCEAN_FOAM_ALBEDO,exp(-lookAge/OCEAN_FOAM_FADE));
}
fn oceanCapDamp(p:vec2<f32>,share:f32)->f32{
  return oceanShelter(p,SHELTER_CHOP)*min(share,1.0);
}
fn oceanCapCoverage(p:vec2<f32>,share:f32)->f32{
  return material.oceanWind.w*oceanCapDamp(p,share);
}
fn oceanCapFire(h:vec2<f32>,k:f32,chance:f32)->f32{
  let n=${capCycle};
  let shift=vec2<f32>(waterSkinHash(vec2<f32>(n,31.0)),waterSkinHash(vec2<f32>(n,77.0)))*512.0;
  return 1.0-step(chance,waterSkinHash(h+shift));
}
fn oceanCapCells(p:vec2<f32>,pixel:f32,share:f32)->f32{
  let q=(p+material.waterSkin.y-material.seaWindTime*OCEAN_CAP_DRIFT)/OCEAN_CAP_CELL;
  let c=floor(q);
  let h=c-512.0*floor(c/512.0);
  let centre=vec2<f32>(waterSkinHash(h+vec2<f32>(13.0,0.0)),waterSkinHash(h+vec2<f32>(0.0,57.0)))*(1.0-2.0*OCEAN_CAP_INSET)+OCEAN_CAP_INSET;
  let at=(c+centre)*OCEAN_CAP_CELL-material.waterSkin.y+material.seaWindTime*OCEAN_CAP_DRIFT;
  let cycle=${capClock}/OCEAN_CAP_PERIOD+waterSkinHash(h);
  let k=floor(cycle);
  let fire=oceanCapFire(h,k,oceanCapCoverage(at,oceanWindAmp(at))/OCEAN_CAP_SHARE);
  let r=length(q-c-centre)/OCEAN_CAP_RADIUS;
  let cap=fire*(1.0-(cycle-k))*(1.0-smoothstep(0.7,1.0,r));
  return mix(cap,oceanCapCoverage(p,share),smoothstep(OCEAN_DETAIL_LO,OCEAN_DETAIL_HI,pixel/(2.0*OCEAN_CAP_RADIUS*OCEAN_CAP_CELL)));
}${bump}${loop}
const LIP_FACE_IRIBARREN_LO:f32=0.4;
const LIP_FACE_IRIBARREN_HI:f32=0.6;
const LIP_THROW:f32=0.6;
const LIP_TILT:f32=0.35;
const LIP_HIGHLIGHT:f32=0.25;
const LIP_BAND_M:f32=0.3;
const LIP_BURST_S:f32=2.0;
const LIP_FRONT:f32=1.5707963267948966;
fn oceanLipFromEnvelope(p:vec2<f32>,env:vec2<f32>,envelope:f32)->vec4<f32>{
  let coast=oceanCoastAt(p.y).coast;
  let d=p.x-coast.x;
  let column=(d-OCEAN_D_MIN)/OCEAN_D_STEP;
  let bay=oceanAtlasRead(OCEAN_ROW_BAY_PROFILE,column);
  let cove=oceanAtlasRead(OCEAN_ROW_COVE_PROFILE,column);
  let h=bay.x+(cove.x-bay.x)*coast.z;
  let a=bay.y+(cove.y-bay.y)*coast.z;
  let b=bay.z+(cove.z-bay.z)*coast.z;
  let unbroken=2.0*envelope;
  let crestPhase=select(0.0,atan2(env.y,env.x),dot(env,env)>0.0);
  let hc=max(h,OCEAN_DRY_DEPTH);
  let gamma=clamp(b-a*unbroken/(OCEAN_G*material.oceanSwell.z*material.oceanSwell.z),WEGGEL_GAMMA_MIN,WEGGEL_GAMMA_MAX);
  let ratio=unbroken/(gamma*hc);
  let progress=clamp((ratio-1.0)/(OCEAN_BREAK_FULL-1.0),0.0,1.0);
  let steepness=max(material.oceanSwell.w,1.0e-6)/(OCEAN_G*material.oceanSwell.z*material.oceanSwell.z/OCEAN_TWO_PI);
  let iribarren=material.oceanCove.w/sqrt(steepness);
  let share=coast.z*smoothstep(LIP_FACE_IRIBARREN_LO,LIP_FACE_IRIBARREN_HI,iribarren)*(1.0-material.oceanWindDir.w)*step(material.oceanCove.z,d)*step(material.oceanCoast.w,1.5);
  let lip=share*smoothstep(0.0,LIP_THROW,progress)*(1.0-smoothstep(LIP_THROW,1.0,progress));
  let ahead=${aheadPhase}-0.5*OCEAN_TWO_PI;
  let front=step(0.0,ahead)*(1.0-smoothstep(0.0,LIP_FRONT,ahead));
  let k=OCEAN_TWO_PI/(material.oceanSwell.z*sqrt(OCEAN_G*hc));
  let band=1.0-smoothstep(0.0,LIP_BAND_M,abs(ahead)/k);
  return vec4<f32>(lip*front,share*step(1.0,progress),lip*band,coast.y);
}
fn oceanLipNormal(n:vec3<f32>,lip:vec4<f32>)->vec3<f32>{
  let shore=normalize(vec2<f32>(1.0,-lip.w));
  return normalize(n+vec3<f32>(shore.x,0.0,shore.y)*(LIP_TILT*lip.x));
}
fn oceanLipFoam(foam:f32,lip:vec4<f32>,foamAge:f32)->f32{
  let burst=lip.y*(1.0-smoothstep(0.0,LIP_BURST_S,foamAge));
  return max(foam,max(LIP_HIGHLIGHT*lip.z,burst));
}
