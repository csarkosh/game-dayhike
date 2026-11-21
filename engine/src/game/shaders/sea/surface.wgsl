
const OCEAN_G:f32=9.81;
const OCEAN_TWO_PI:f32=6.283185307179586;
const OCEAN_D_MIN:f32=-1000.0;
const OCEAN_D_STEP:f32=1.0;
const OCEAN_TABLE_SAMPLES:f32=1040.0;
const OCEAN_ATLAS_ROWS:f32=28.0;
const OCEAN_ROW_BAY_PROFILE:f32=0.0;
const OCEAN_ROW_COVE_PROFILE:f32=1.0;
const OCEAN_ROW_BAY_FIRST:f32=2.0;
const OCEAN_ROW_COVE_FIRST:f32=14.0;
const OCEAN_ROW_COAST:f32=27.0;
const OCEAN_DRY_DEPTH:f32=0.05;
const WEGGEL_GAMMA_MIN:f32=0.78;
const WEGGEL_GAMMA_MAX:f32=1.56;
const SWELL_Q_SUM_MAX:f32=0.9;
const OCEAN_BORE_RATIO:f32=0.42;
const OCEAN_BREAK_FULL:f32=1.5;
const OCEAN_BREAK_FOAM_LO:f32=1.0;
const OCEAN_BREAK_FOAM_HI:f32=1.3;
const OCEAN_FOAM_LIFE:f32=20.0;
const OCEAN_ROLL_WIDTH:f32=0.6;
const OCEAN_INNER_FOAM:f32=0.5;
const SHELTER_SWELL:f32=0.3;
const SHELTER_CHOP:f32=0.15;
const SHELTER_WIDTH:f32=40.0;
const OCEAN_RESOLVE_PHASE_LO:f32=1.5707963267948966;
const OCEAN_RESOLVE_PHASE_HI:f32=3.141592653589793;
const OCEAN_RING_BASE:f32=1.0;
const OCEAN_RING_REACH:f32=32.0;
const LOOP_N:f32=128.0;
const LOOP_SIZE:f32=60.0;
const LOOP_FRAMES:f32=64.0;
const LOOP_SECONDS:f32=20.0;
const OCEAN_LOOP_SCALE_MIN:f32=0.0025;
const OCEAN_WIND_TILE_CELLS:f32=16.0;
const OCEAN_FETCH_RATIO:f32=0.005714285714285714;
const WIND_SEA_U_FLOOR:f32=0.5;
fn oceanAtlasTexel(row:f32,column:f32)->vec4<f32>{
  return textureLoad(oceanAtlas,vec2<i32>(i32(column),i32(row)),0);
}
fn oceanAtlasRead(row:f32,column:f32)->vec4<f32>{
  let c=clamp(column,0.0,OCEAN_TABLE_SAMPLES-1.0);
  let i0=floor(c);
  let a=oceanAtlasTexel(row,i0);
  let b=oceanAtlasTexel(row,min(i0+1.0,OCEAN_TABLE_SAMPLES-1.0));
  return a+(b-a)*(c-i0);
}
fn oceanAtlasRow(row:f32,d:f32)->vec4<f32>{
  return oceanAtlasRead(row,(d-OCEAN_D_MIN)/OCEAN_D_STEP);
}
struct OceanCoastRead{coast:vec4<f32>,phaseDz:f32}
fn oceanCoastAt(z:f32)->OceanCoastRead{
  let column=(z-material.oceanCoast.x)/material.oceanCoast.y;
  let c=clamp(column,0.0,OCEAN_TABLE_SAMPLES-1.0);
  let i0=floor(c);
  let a=oceanAtlasTexel(OCEAN_ROW_COAST,i0);
  let b=oceanAtlasTexel(OCEAN_ROW_COAST,min(i0+1.0,OCEAN_TABLE_SAMPLES-1.0));
  var o:OceanCoastRead;
  o.phaseDz=select((b.w-a.w)/material.oceanCoast.y,0.0,column<0.0);
  o.coast=a+(b-a)*(c-i0);
  return o;
}
fn oceanShelterTip(p:vec2<f32>,tip:vec2<f32>,keep:f32)->f32{
  let u=material.oceanSwell.xy;
  let r=p-tip;
  let side=select(-1.0,1.0,u.y>=0.0);
  let on=step(0.0,dot(u,r))*step(0.0,r.y*side);
  let lambda=-(u.x*r.y-u.y*r.x)*side;
  return 1.0-(1.0-keep)*smoothstep(0.0,SHELTER_WIDTH,lambda)*on;
}
fn oceanShelter(p:vec2<f32>,keep:f32)->f32{
  return oceanShelterTip(p,material.oceanTips.xy,keep)*oceanShelterTip(p,material.oceanTips.zw,keep);
}
struct OceanSwellSum{disp:vec3<f32>,normal:vec3<f32>,foam:vec4<f32>,drawn:f32,env:vec2<f32>}
fn oceanSwellSum(p:vec2<f32>,dpx:vec2<f32>,dpy:vec2<f32>)->OceanSwellSum{
  let coastRead=oceanCoastAt(p.y);
  let coast=coastRead.coast;
  let phaseDz=coastRead.phaseDz;
  let d=p.x-coast.x;
  let column=(d-OCEAN_D_MIN)/OCEAN_D_STEP;
  let deep=min(d-OCEAN_D_MIN,0.0);
  let bay=oceanAtlasRead(OCEAN_ROW_BAY_PROFILE,column);
  let cove=oceanAtlasRead(OCEAN_ROW_COVE_PROFILE,column);
  let h=bay.x+(cove.x-bay.x)*coast.z;
  let a=bay.y+(cove.y-bay.y)*coast.z;
  let b=bay.z+(cove.z-bay.z)*coast.z;
  let shelter=oceanShelter(p,SHELTER_SWELL);
  var theta:array<f32,12>;
  theta[0]=material.oceanPhase0.x;
  theta[1]=material.oceanPhase0.y;
  theta[2]=material.oceanPhase0.z;
  theta[3]=material.oceanPhase0.w;
  theta[4]=material.oceanPhase1.x;
  theta[5]=material.oceanPhase1.y;
  theta[6]=material.oceanPhase1.z;
  theta[7]=material.oceanPhase1.w;
  theta[8]=material.oceanPhase2.x;
  theta[9]=material.oceanPhase2.y;
  theta[10]=material.oceanPhase2.z;
  theta[11]=material.oceanPhase2.w;
  var phi:array<f32,12>;
  var amp:array<f32,12>;
  var q0:array<f32,12>;
  var kv:array<vec2<f32>,12>;
  var sn:array<f32,12>;
  var cs:array<f32,12>;
  var env=vec2<f32>(0.0);
  for(var c:i32=0;c<12;c++){
    let fc=f32(c);
    if(fc>=material.oceanCoast.z){break;}
    let k=bitcast<vec4<f32>>(material.oceanK[c]);
    let rb=oceanAtlasRead(OCEAN_ROW_BAY_FIRST+fc,column);
    let rc=oceanAtlasRead(OCEAN_ROW_COVE_FIRST+fc,column);
    let dpsi=rc.x-rb.x;
    let psi=rb.x+dpsi*coast.w+k.x*deep;
    let kn=rb.y+(rc.y-rb.y)*coast.w;
    let shoal=rb.z+(rc.z-rb.z)*coast.z;
    phi[c]=psi+k.x*coast.x+k.y*p.y+theta[c];
    kv[c]=vec2<f32>(kn,k.y+(k.x-kn)*coast.y+dpsi*phaseDz);
    amp[c]=k.w*shoal*shelter;
    q0[c]=k.z;
    sn[c]=sin(phi[c]);
    cs[c]=cos(phi[c]);
    env+=amp[c]*vec2<f32>(cs[c],sn[c]);
  }
  let envelope=length(env);
  let unbroken=2.0*envelope;
  let crestPhase=select(0.0,atan2(env.y,env.x),dot(env,env)>0.0);
  let hc=max(h,OCEAN_DRY_DEPTH);
  let gamma=clamp(b-a*unbroken/(OCEAN_G*material.oceanSwell.z*material.oceanSwell.z),WEGGEL_GAMMA_MIN,WEGGEL_GAMMA_MAX);
  let ratio=unbroken/(gamma*hc);
  var scale=1.0;
  if(ratio>1.0){
    let cap=gamma+(OCEAN_BORE_RATIO-gamma)*smoothstep(1.0,OCEAN_BREAK_FULL,ratio);
    scale=hc*cap/max(unbroken,1.0e-6);
  }
  let breaking=smoothstep(OCEAN_BREAK_FOAM_LO,OCEAN_BREAK_FOAM_HI,ratio);
  var steepness=0.0;
  for(var c:i32=0;c<12;c++){
    if(f32(c)>=material.oceanCoast.z){break;}
    amp[c]*=scale;
    steepness+=q0[c]*length(kv[c])*amp[c];
  }
  let s=min(1.0,SWELL_Q_SUM_MAX/max(steepness,1.0e-6));
  var height=0.0;
  var across=vec2<f32>(0.0);
  var slope=vec2<f32>(0.0);
  var fold=0.0;
  var o:OceanSwellSum;
  o.drawn=0.0;
  for(var c:i32=0;c<12;c++){
    if(f32(c)>=material.oceanCoast.z){break;}
    let turn=max(abs(dot(dpx,kv[c])),abs(dot(dpy,kv[c])));
    if(turn>=OCEAN_RESOLVE_PHASE_HI){continue;}
    let kmag=length(kv[c]);
    let A=amp[c]*(1.0-smoothstep(OCEAN_RESOLVE_PHASE_LO,OCEAN_RESOLVE_PHASE_HI,turn));
    let Q=q0[c]*s;
    height+=A*cs[c];
    across-=Q*A*kv[c]*sn[c]/kmag;
    slope+=A*kv[c]*sn[c];
    fold+=Q*A*kmag*cs[c];
    o.drawn+=0.5*(A*kmag)*(A*kmag);
  }
  o.disp=vec3<f32>(across.x,height,across.y);
  o.normal=normalize(vec3<f32>(slope.x,1.0-fold,slope.y));
  let foamAge=${foamPhase}/(OCEAN_TWO_PI/material.oceanSwell.z);
  let roll=breaking*(1.0-smoothstep(0.0,OCEAN_ROLL_WIDTH,${rollPhase}));
  let trailing=breaking*exp(-foamAge/OCEAN_FOAM_LIFE);
  o.foam=vec4<f32>(max(max(roll,trailing),breaking*OCEAN_INNER_FOAM),breaking,foamAge,h);
  o.env=env;
  return o;
}
fn oceanFoamFromEnvelope(p:vec2<f32>,env:vec2<f32>,envelope:f32)->vec4<f32>{
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
  let breaking=smoothstep(OCEAN_BREAK_FOAM_LO,OCEAN_BREAK_FOAM_HI,ratio);
  let foamAge=${foamPhase}/(OCEAN_TWO_PI/material.oceanSwell.z);
  let roll=breaking*(1.0-smoothstep(0.0,OCEAN_ROLL_WIDTH,${rollPhase}));
  let trailing=breaking*exp(-foamAge/OCEAN_FOAM_LIFE);
  return vec4<f32>(max(max(roll,trailing),breaking*OCEAN_INNER_FOAM),breaking,foamAge,h);
}
fn oceanSwellPixelKeep(dpx:vec2<f32>,dpy:vec2<f32>)->f32{
  let kDeep=OCEAN_TWO_PI*OCEAN_TWO_PI/(OCEAN_G*material.oceanSwell.z*material.oceanSwell.z);
  let u=material.oceanSwell.xy;
  return 1.0-smoothstep(OCEAN_RESOLVE_PHASE_LO,OCEAN_RESOLVE_PHASE_HI,kDeep*max(abs(dot(dpx,u)),abs(dot(dpy,u))));
}
fn oceanRingCell(p:vec2<f32>)->f32{
  let r=abs(p-scene.vEyePosition.xz);
  return max(OCEAN_RING_BASE,max(r.x,r.y)/OCEAN_RING_REACH);
}
fn oceanWindAmp(p:vec2<f32>)->f32{
  let fetch=max(oceanCoastAt(p.y).coast.x-p.x,0.0);
  let share=min(1.0,OCEAN_FETCH_RATIO*sqrt(OCEAN_G*fetch)/max(material.oceanWindDir.z,WIND_SEA_U_FLOOR));
  return share+(1.0-share)*material.oceanWindDir.w;
}${loop}
struct OceanDisplaced{disp:vec3<f32>,swell:vec4<f32>,env:vec2<f32>}
fn oceanDisplace(p:vec2<f32>)->OceanDisplaced{
  let cell=oceanRingCell(p);
  let sum=oceanSwellSum(p,vec2<f32>(2.0*cell,0.0),vec2<f32>(0.0,2.0*cell));
  var o:OceanDisplaced;
  o.swell=vec4<f32>(sum.normal.x,sum.normal.z,sum.disp.y,sum.drawn);
  o.env=sum.env;
  ${displace}
  return o;
}
const SWASH_COLUMNS:f32=512.0;
const SWASH_HALF:f32=256.0;
const SWASH_SHEET_MIN:f32=0.001;
const OCEAN_REST_EPS:f32=0.00001;
const OCEAN_COVE_END:f32=30.0;
fn swashSheet(d:f32,z:f32)->f32{
  let col=textureLoad(oceanSwash,vec2<i32>(i32(floor(clamp(z-material.oceanCove.x+SWASH_HALF,0.0,SWASH_COLUMNS-1.0)+0.5)),0),0);
  let cover=step(material.oceanCove.z,d)*step(d,col.x);
  return cover*col.y*clamp(1.0-d/max(col.x,SWASH_SHEET_MIN),0.0,1.0);
}
fn oceanCoveShare(z:f32)->f32{
  return 1.0-smoothstep(material.oceanCove.y-OCEAN_COVE_END,material.oceanCove.y+OCEAN_COVE_END,abs(z-material.oceanCove.x));
}
fn swashLift(p:vec2<f32>,h:f32,swell:f32)->f32{
  let sheet=swashSheet(p.x-oceanCoastAt(p.y).coast.x,p.y);
  let lift=max(0.0,sheet-h)*step(SWASH_SHEET_MIN,sheet);
  let rest=max(0.0,-(h+swell))*step(1.0e-6,oceanCoveShare(p.y));
  return max(lift,rest);
}
fn swashDepth(p:vec2<f32>)->f32{
  let coast=oceanCoastAt(p.y).coast;
  let column=(p.x-coast.x-OCEAN_D_MIN)/OCEAN_D_STEP;
  let bay=oceanAtlasRead(OCEAN_ROW_BAY_PROFILE,column).x;
  return bay+(oceanAtlasRead(OCEAN_ROW_COVE_PROFILE,column).x-bay)*coast.z;
}
