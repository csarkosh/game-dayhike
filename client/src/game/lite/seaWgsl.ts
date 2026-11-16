/**
 * The sea's waves and shading in WGSL, statement for statement the game's
 * GLSL: what `shaders/oceanSurface.fx`, `oceanSwash.fx`,
 * `oceanDisplace.vertex.fx`, `oceanShade.fragment.fx`, the rain's rings of
 * `water.fragment.fx` and the sea's halves of `waterLights.fragment.fx` and
 * `waterCompose.fragment.fx` say of the sea on the tiers that blend their
 * water over what lies under it (`waterPlugin.ts` on Babylon.js splices the
 * GLSL into its PBR material; `seaPlugin.ts` here hands these to Lite's).
 * The water's own definitions are `waterWgsl.ts`'s, which a lake reads too.
 *
 * What is written differently, and why:
 *
 * - **Uniforms** are read as `material.<name>` under the GLSL's names; the
 *   ones that move with the frame are the frame's (`frameBlock.ts`), and the
 *   plugin turns their reads to the block. Three of them are the sea's
 *   under names of their own, since a lake's material reads the same GLSL
 *   names with other values: its clock (`seaTime` for `waterTime`), the
 *   wind's direction integrated over the run (`seaWindTime` for
 *   `waterWindTime`) and the bump's drift (`seaBumpOffset`). The swell's
 *   components and the rings' records are arrays, which Lite lays out as
 *   vec4s of bits and the stage casts back.
 * - **The tables** (the swell's atlas, the swash's row) are 32-bit floats
 *   the GLSL reads at a texel's centre with a nearest sampler: here
 *   `textureLoad` at that texel.
 * - **A function's several results** are a struct it returns, where the
 *   GLSL writes them through `out` parameters.
 * - **A vertex is placed by the stage itself.** On Babylon.js a ring's mesh
 *   is made again when the ring moves and its vertices carry their place,
 *   their stitch to the coarser ring and the depth of water under them. Here
 *   the rings are one lattice made once (`seaLattice.ts`): a vertex carries
 *   its column, its row and its ring, the stage reads where the ring and
 *   its hole stand from the frame's block and works out the place and the
 *   stitch as `water.ts` does (`seaVertexAt` is the same arithmetic, held to
 *   `waterRingGeometry` by the tests), and the depth is read from a table a
 *   ring. A cell of the hole's frame that the finer ring covers is drawn as
 *   nothing: its four vertices are put at one point.
 * - **The first ripple octave** on the tier that draws the wind sea with it
 *   is the PBR material's own bump on Babylon.js. Here the plugin reads the
 *   same picture at the lattice's coordinate plus the drift and turns it on
 *   the frame Babylon.js derives from the screen's derivatives of the place
 *   and the coordinate about the ring's own normal, which is up
 *   (`SEA_BUMP_WGSL`), for the side seen from above.
 * - **The wind sea's field** is read only on the tiers that draw one: the
 *   loop's branch where the field is the baked loop, and before it the three
 *   cascades' branch on the tier whose field is computed each frame, which
 *   falls back to the loop where that cannot be had (`windSeaField.ts`). The
 *   cascades' slopes are read through the displacement's sampler, which is
 *   set as theirs is. Where no field is drawn its displacement and its
 *   slopes are nothing in the GLSL, and the statements that only scale them
 *   are left out.
 * - **The skin** is off on the sea (its share is 0), and its statements are
 *   left out; the roughness the GLSL writes over Babylon.js's own line is
 *   set where the sea's statements end, before Lite derives anything from
 *   it.
 * - **`mod`** is written out as `x - y * floor(x / y)`: WGSL's `%`
 *   truncates.
 *
 * Left out, as nothing here reads it: the read of the frame behind the
 * surface.
 *
 * Loads nothing.
 */
import { HOLE_CELLS } from "../clipmap.js";
import { WATER_RING_CELLS, WATER_RING_COUNT, WATER_UV_SCALE } from "../water.js";

/** What a tier's sea is drawn with beside its swell. */
export type SeaLook = {
  /** A field of the wind sea is read: the baked loop's branch is in the stages. */
  loop: boolean;
  /** The three cascades computed each frame are read too, before the loop (the tier that computes them; never without `loop`). */
  fft?: boolean;
  /** The ripple bump draws the wind sea (the tier with no field of it). */
  bump: boolean;
};

const mod = (x: string, y: string): string => `(${x}-${y}*floor((${x})/${y}))`;

/** The cascades' size and their tiles' lengths, metres (`oceanSpectrum.ts`). */
const FFT_CONSTS_WGSL = /* wgsl */ `
const FFT_N:f32=256.0;
const FFT_CASCADE_0:f32=1000.0;
const FFT_CASCADE_1:f32=150.0;
const FFT_CASCADE_2:f32=25.0;`;

/**
 * The cascades' branch before the loop's, where the look reads them: `body`
 * while the wind sea's mode says the cascades are drawn, else the loop's
 * branch, which follows. Nothing where the look has no cascades.
 */
function cascadesBranch(look: SeaLook): (body: string) => string {
  return (body) => (look.fft === true ? `if(material.oceanCoast.w>1.5){
    ${body}
  }else ` : "");
}

/** `oceanSurface.fx` and `oceanSwash.fx`: the swell's sum, the wind sea's field and the swash's sheet, for both stages. */
export function seaSurfaceWgsl(look: SeaLook): string {
  const cascades = cascadesBranch(look);
  const loop = !look.loop ? "" : /* wgsl */ `${look.fft === true ? FFT_CONSTS_WGSL : ""}
fn oceanWindFrame(p:vec2<f32>)->vec2<f32>{
  let d=material.oceanWindDir.xy;
  let r=p-material.oceanWindPivot.xy;
  return vec2<f32>(dot(r,d),d.x*r.y-d.y*r.x);
}
fn oceanFromWind(v:vec2<f32>)->vec2<f32>{
  let d=material.oceanWindDir.xy;
  return vec2<f32>(v.x*d.x-v.y*d.y,v.x*d.y+v.y*d.x);
}
fn oceanLoopSize()->f32{
  return LOOP_SIZE*max(material.oceanWind.y,OCEAN_LOOP_SCALE_MIN);
}
fn oceanLoopRead(uv:vec2<f32>)->vec3<f32>{
  let f=material.oceanWind.z/LOOP_SECONDS*LOOP_FRAMES;
  let f0=floor(f);
  let a=textureSampleLevel(oceanWindDisp,oceanWindDispSampler,uv,i32(f0),0.0).xyz;
  let b=textureSampleLevel(oceanWindDisp,oceanWindDispSampler,uv,i32(${mod("(f0+1.0)", "LOOP_FRAMES")}),0.0).xyz;
  return a+(b-a)*(f-f0);
}
fn oceanWindRingKeep(size:f32,cell:f32)->f32{
  return 1.0-smoothstep(1.0,2.0,OCEAN_WIND_TILE_CELLS*cell/size);
}
fn oceanWindDisplaceAt(p:vec2<f32>,cell:f32)->vec3<f32>{
  let w=oceanWindFrame(p);
  var t=vec3<f32>(0.0);
  ${cascades(`t=textureSampleLevel(oceanWindDisp,oceanWindDispSampler,w/FFT_CASCADE_0,0,0.0).xyz*oceanWindRingKeep(FFT_CASCADE_0,cell)
      +textureSampleLevel(oceanWindDisp,oceanWindDispSampler,w/FFT_CASCADE_1,1,0.0).xyz*oceanWindRingKeep(FFT_CASCADE_1,cell)
      +textureSampleLevel(oceanWindDisp,oceanWindDispSampler,w/FFT_CASCADE_2,2,0.0).xyz*oceanWindRingKeep(FFT_CASCADE_2,cell);`)}if(material.oceanCoast.w>0.5){
    let size=oceanLoopSize();
    t=oceanLoopRead(w/size)*(size/LOOP_SIZE)*oceanWindRingKeep(size,cell);
  }
  let across=oceanFromWind(t.yz);
  return vec3<f32>(across.x,t.x,across.y);
}
fn oceanWindDisplace(p:vec2<f32>)->vec3<f32>{
  return oceanWindDisplaceAt(p,0.0);
}`;
  const displace = look.loop
    ? `let chop=oceanWindAmp(p)*(1.0-sum.foam.y)*oceanShelter(p,SHELTER_CHOP);
  o.disp=sum.disp+oceanWindDisplaceAt(p,cell)*chop;`
    : `o.disp=sum.disp;`;
  return /* wgsl */ `
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
  let foamAge=${mod("(-crestPhase)", "OCEAN_TWO_PI")}/(OCEAN_TWO_PI/material.oceanSwell.z);
  let roll=breaking*(1.0-smoothstep(0.0,OCEAN_ROLL_WIDTH,${mod("crestPhase", "OCEAN_TWO_PI")}));
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
  let foamAge=${mod("(-crestPhase)", "OCEAN_TWO_PI")}/(OCEAN_TWO_PI/material.oceanSwell.z);
  let roll=breaking*(1.0-smoothstep(0.0,OCEAN_ROLL_WIDTH,${mod("crestPhase", "OCEAN_TWO_PI")}));
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
}`;
}

/** A lattice vertex's ring, where the ring and its hole stand, and the ring's spacing. */
const SEA_RING_WGSL = /* wgsl */ `
  let seaRing=u32(position.y+0.5);
  let seaRecord=bitcast<vec4<f32>>(material.seaRings[seaRing]);
  let seaSpacing=f32(1u<<seaRing);`;

/** A cell of the hole's frame that the finer ring covers, drawn as nothing: its four vertices at one point. */
const SEA_HOLE_WGSL = /* wgsl */ `
  if(seaRing>0u&&uv.x>=0.0){
    let seaCell=uv-seaRecord.zw;
    if(seaCell.x>=0.0&&seaCell.x<${HOLE_CELLS}.0&&seaCell.y>=0.0&&seaCell.y<${HOLE_CELLS}.0){out.clipPos=vec4<f32>(0.0,0.0,-1.0,1.0);}
  }`;

/**
 * The vertex stage's last step: the lattice's vertex placed on its ring
 * (`seaVertexAt`), then `oceanDisplace.vertex.fx` on that place, and the
 * depth of water under it from its ring's table.
 */
export const SEA_VERTEX_WGSL = /* wgsl */ `{${SEA_RING_WGSL}
  var oceanMorph=0.0;
  var oceanCoarse=vec2<f32>(0.0);
  if(seaRing<${WATER_RING_COUNT - 1}u){
    let seaOut=min(min(position.x,${WATER_RING_CELLS}.0-position.x),min(position.z,${WATER_RING_CELLS}.0-position.z));
    var seaIn=max(abs(position.x-${WATER_RING_CELLS / 2}.0),abs(position.z-${WATER_RING_CELLS / 2}.0));
    if(seaRing>0u){
      let seaDx=max(max(seaRecord.z-position.x,position.x-(seaRecord.z+${HOLE_CELLS}.0)),0.0);
      let seaDz=max(max(seaRecord.w-position.z,position.z-(seaRecord.w+${HOLE_CELLS}.0)),0.0);
      seaIn=max(seaDx,seaDz);
    }
    let seaSpan=seaIn+seaOut;
    oceanMorph=select(seaIn/seaSpan,1.0,seaSpan==0.0);
    let seaOddX=(i32(position.x)&1)==1;
    let seaOddZ=(i32(position.z)&1)==1;
    oceanCoarse=vec2<f32>(select(0.0,seaSpacing,seaOddX),select(0.0,select(seaSpacing,-seaSpacing,seaOddX),seaOddZ));
  }
  let seaAt=seaRecord.xy+position.xz*seaSpacing;
  var positionUpdated=vec3<f32>(seaAt.x,material.waterLevel,seaAt.y);
  positionUpdated=vec3<f32>(positionUpdated.x-oceanMorph*oceanCoarse.x,positionUpdated.y,positionUpdated.z-oceanMorph*oceanCoarse.y);
  let vOceanXZ=positionUpdated.xz;
  let oceanVertex=oceanDisplace(positionUpdated.xz);
  positionUpdated+=oceanVertex.disp;
  out.vOceanXZ=vOceanXZ;
  out.vOceanSwellA=oceanVertex.swell;
  out.vOceanSwellB=vec4<f32>(oceanVertex.env,length(oceanVertex.env),0.0);
  positionUpdated.y+=swashLift(vOceanXZ,swashDepth(vOceanXZ),oceanVertex.disp.y);
  out.worldPos=positionUpdated;
  out.clipPos=scene.viewProjection*vec4<f32>(positionUpdated,1.0);
  out.uv=seaAt/${WATER_UV_SCALE}.0;
  out.vBedDepth=textureLoad(seaBed,vec2<i32>(position.xz),i32(seaRing),0).r;
  out.vWaterViewDepth=out.clipPos.w;${SEA_HOLE_WGSL}
}`;

/**
 * The lattice's vertex at rest: on its ring at `level`, no wave on it. What
 * the rain's cover map draws the sea as, as the game draws its rings there
 * with the map's own material.
 */
export function seaRestVertexWgsl(level: number): string {
  return /* wgsl */ `{${SEA_RING_WGSL}
  let seaAt=seaRecord.xy+position.xz*seaSpacing;
  out.worldPos=vec3<f32>(seaAt.x,${level.toFixed(4)},seaAt.y);
  out.clipPos=scene.viewProjection*vec4<f32>(out.worldPos,1.0);${SEA_HOLE_WGSL}
}`;
}

/** The rain's rings of `water.fragment.fx`, the puddles' own: the sea's. */
export const SEA_RAIN_WGSL = /* wgsl */ `
const WATER_RAIN_RADIUS:f32=0.25;
const WATER_RAIN_INSET:f32=0.25;
fn waterRainLayer(xz:vec2<f32>,t:f32,layer:f32,scale:f32,offset:vec2<f32>,timeMul:f32,timeAdd:f32)->vec2<f32>{
  let p=xz*scale+offset;
  let c=floor(p);
  let h=c-512.0*floor(c/512.0);
  let centre=vec2<f32>(waterSkinHash(h+vec2<f32>(37.0,0.0)),waterSkinHash(h+vec2<f32>(0.0,91.0)))*(1.0-2.0*WATER_RAIN_INSET)+WATER_RAIN_INSET;
  let d=p-c-centre;
  let dist=length(d);
  let r=clamp(1.0-dist/WATER_RAIN_RADIUS,0.0,1.0);
  let dir=d/max(dist,0.0001);
  let w=clamp(material.waterRain*4.0-layer,0.0,1.0);
  let drop=fract(waterSkinHash(h)+t*timeMul+timeAdd);
  let rt=drop-1.0+r;
  let f=clamp(0.2+w*0.8-drop,0.0,1.0);
  return dir*f*r*sin(clamp(rt*9.0,0.0,3.0)*3.14159)*0.35;
}
fn waterRainSlope(xz:vec2<f32>)->vec2<f32>{
  if(material.waterRain<=0.0){return vec2<f32>(0.0);}
  let t=${mod("material.seaTime", "3600.0")};
  return waterRainLayer(xz,t,0.0,2.5,vec2<f32>(0.0,0.0),1.0,0.0)
    +waterRainLayer(xz,t,1.0,3.2,vec2<f32>(0.37,0.61),0.85,0.2)
    +waterRainLayer(xz,t,2.0,2.1,vec2<f32>(0.71,0.13),0.93,0.45)
    +waterRainLayer(xz,t,3.0,3.8,vec2<f32>(0.19,0.83),1.13,0.7);
}`;

/** `oceanShade.fragment.fx`: the white water, the whitecaps, the wind sea's slopes and the plunging lip. */
export function seaShadeWgsl(look: SeaLook): string {
  const cascades = cascadesBranch(look);
  const loop = !look.loop ? "" : /* wgsl */ `
fn oceanWindPixelKeep(size:f32,n:f32,pixel:f32)->f32{
  return 1.0-smoothstep(OCEAN_RESOLVE_PHASE_LO,OCEAN_RESOLVE_PHASE_HI,0.5*OCEAN_TWO_PI*n*pixel/size);
}
struct OceanWindSlopes{slope:vec2<f32>,drawn:f32}
fn oceanWindSlopesAt(p:vec2<f32>,pixel:f32)->OceanWindSlopes{
  let w=oceanWindFrame(p);
  var g=vec2<f32>(0.0);
  var o:OceanWindSlopes;
  o.drawn=0.0;
  ${cascades(`let k0=oceanWindPixelKeep(FFT_CASCADE_0,FFT_N,pixel);
    let k1=oceanWindPixelKeep(FFT_CASCADE_1,FFT_N,pixel);
    let k2=oceanWindPixelKeep(FFT_CASCADE_2,FFT_N,pixel);
    g=textureSampleLevel(oceanWindSlope,oceanWindDispSampler,w/FFT_CASCADE_0,0,0.0).xy*k0
      +textureSampleLevel(oceanWindSlope,oceanWindDispSampler,w/FFT_CASCADE_1,1,0.0).xy*k1
      +textureSampleLevel(oceanWindSlope,oceanWindDispSampler,w/FFT_CASCADE_2,2,0.0).xy*k2;
    o.drawn=k0*k0*material.oceanWindStats.y+k1*k1*material.oceanWindStats.z+k2*k2*material.oceanWindStats.w;`)}if(material.oceanCoast.w>0.5){
    let size=oceanLoopSize();
    let uv=w/size;
    let e=1.0/LOOP_N;
    let keep=oceanWindPixelKeep(size,LOOP_N,pixel);
    let gx=oceanLoopRead(uv+vec2<f32>(e,0.0)).x-oceanLoopRead(uv-vec2<f32>(e,0.0)).x;
    let gz=oceanLoopRead(uv+vec2<f32>(0.0,e)).x-oceanLoopRead(uv-vec2<f32>(0.0,e)).x;
    g=vec2<f32>(gx,gz)*(LOOP_N/(2.0*LOOP_SIZE))*keep;
    o.drawn=keep*keep*material.oceanWindStats.y;
  }
  o.slope=-oceanFromWind(g);
  return o;
}
fn oceanCrestKeep(pixel:f32)->f32{
  ${look.fft === true ? "if(material.oceanCoast.w>1.5){return oceanWindPixelKeep(FFT_CASCADE_1,FFT_N,pixel);}\n  " : ""}return oceanWindPixelKeep(oceanLoopSize(),LOOP_N,pixel);
}
fn oceanCapThreshold(coverage:f32)->f32{
  let s=sqrt(-2.0*log(clamp(coverage,1.0e-6,0.5)));
  return s-(2.515517+0.802853*s+0.010328*s*s)/(1.0+1.432788*s+0.189269*s*s+0.001308*s*s*s);
}
fn oceanWhitecap(coverage:f32,crest:f32)->f32{
  let t=oceanCapThreshold(coverage);
  return smoothstep(t-0.5*OCEAN_CAP_SOFT,t+0.5*OCEAN_CAP_SOFT,crest)*step(1.0e-6,coverage);
}
fn oceanWindSlopeLimit(u10:f32,shelter:f32,drawn:f32)->f32{
  return min(1.0,sqrt((WATER_COX_MUNK_A+WATER_COX_MUNK_B*u10)*shelter/max(drawn,1.0e-6)));
}`;
  const bump = !look.bump ? "" : /* wgsl */ `
const OCEAN_BUMP_HS:f32=1.0;
const OCEAN_BUMP_MAX:f32=2.0;
fn oceanBumpScale(share:f32,breaking:f32,shelter:f32)->f32{
  return min(material.oceanWind.x*share*(1.0-breaking)*shelter/OCEAN_BUMP_HS,OCEAN_BUMP_MAX);
}`;
  return /* wgsl */ `
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
  let n=${mod("k", "OCEAN_CAP_CYCLES")};
  let shift=vec2<f32>(waterSkinHash(vec2<f32>(n,31.0)),waterSkinHash(vec2<f32>(n,77.0)))*512.0;
  return 1.0-step(chance,waterSkinHash(h+shift));
}
fn oceanCapCells(p:vec2<f32>,pixel:f32,share:f32)->f32{
  let q=(p+material.waterSkin.y-material.seaWindTime*OCEAN_CAP_DRIFT)/OCEAN_CAP_CELL;
  let c=floor(q);
  let h=c-512.0*floor(c/512.0);
  let centre=vec2<f32>(waterSkinHash(h+vec2<f32>(13.0,0.0)),waterSkinHash(h+vec2<f32>(0.0,57.0)))*(1.0-2.0*OCEAN_CAP_INSET)+OCEAN_CAP_INSET;
  let at=(c+centre)*OCEAN_CAP_CELL-material.waterSkin.y+material.seaWindTime*OCEAN_CAP_DRIFT;
  let cycle=${mod("material.seaTime", "(OCEAN_CAP_CYCLES*OCEAN_CAP_PERIOD)")}/OCEAN_CAP_PERIOD+waterSkinHash(h);
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
  let ahead=${mod("(crestPhase+0.5*OCEAN_TWO_PI)", "OCEAN_TWO_PI")}-0.5*OCEAN_TWO_PI;
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
}`;
}

/**
 * The first ripple octave under the sea that draws its wind sea with it:
 * the bump's picture at the lattice's coordinate plus the drift, turned on
 * the frame Babylon.js builds for a normal map with no tangents (the
 * screen's derivatives of the place and of the coordinate, about the ring's
 * own normal, which is up; a derivative down the screen taken the other way
 * round, as Babylon.js's are), and left as the lighting normal. The albedo
 * is taken back to the base colour, which is what Babylon.js hands that
 * point.
 */
export const SEA_BUMP_WGSL = /* wgsl */ `
surfaceAlbedo=baseColor;
{
  let wMap=textureSample(waterBump,waterBumpSampler,input.uv+material.seaBumpOffset).xyz*2.0-1.0;
  let wUp=vec3<f32>(0.0,1.0,0.0);
  let wDp1=dpdx(input.worldPos);
  let wDp2=-dpdy(input.worldPos);
  let wDuv1=dpdx(input.uv);
  let wDuv2=-dpdy(input.uv);
  let wDp2perp=cross(wDp2,wUp);
  let wDp1perp=cross(wUp,wDp1);
  let wTangent=wDp2perp*wDuv1.x+wDp1perp*wDuv2.x;
  let wBitangent=wDp2perp*wDuv1.y+wDp1perp*wDuv2.y;
  let wDet=max(dot(wTangent,wTangent),dot(wBitangent,wBitangent));
  let wInvmax=select(inverseSqrt(wDet),0.0,wDet==0.0);
  N=normalize(wTangent*(wInvmax*wMap.x)+wBitangent*(wInvmax*wMap.y)+wUp*wMap.z);
}`;

/** Where no bump is read: the albedo taken back to the base colour alone. */
export const SEA_ALBEDO_WGSL = "surfaceAlbedo=baseColor;";

/** The sea's half of `waterLights.fragment.fx` where its water is blended, then the roughness of the slope variance its normal leaves undrawn. */
export function seaLightsWgsl(look: SeaLook): string {
  const wind = look.loop
    ? `let wWind=oceanWindDisplace(input.vOceanXZ);
let wWindSlopes=oceanWindSlopesAt(input.vOceanXZ,max(length(wOceanDx),length(wOceanDy)));
let wWindDrawn=wWindSlopes.drawn;
let wWindSlope=wWindSlopes.slope;
let wSurfaceHeight=wOceanHeight+wWind.y*wWindAmp;`
    : `let wSurfaceHeight=wOceanHeight;`;
  const steep = look.loop ? `let wWindSteep=wWindAmp*oceanWindSlopeLimit(material.oceanWindDir.z,wOceanChop,wWindDrawn*wWindAmp*wWindAmp);` : "";
  const extra = [
    ...(look.bump ? ["N.xz/max(N.y,0.05)*oceanBumpScale(wWindShare,wOceanFoam.y,wOceanChop)"] : []),
    ...(look.loop ? ["wWindSlope*wWindSteep"] : []),
  ].join("+") || "vec2<f32>(0.0)";
  const variance = look.loop ? "wOceanDrawn+wWindDrawn*wWindSteep*wWindSteep" : "wOceanDrawn";
  const cap = look.loop
    ? `if(material.oceanCoast.w>0.5){
  let wCapCover=oceanCapCoverage(input.vOceanXZ,wWindShare);
  wOceanCap=mix(wCapCover,oceanWhitecap(wCapCover,wWind.y/max(material.oceanWindStats.x,1.0e-4)),oceanCrestKeep(wOceanPixel));
}else{
  wOceanCap=oceanCapCells(input.vOceanXZ,wOceanPixel,wWindShare);
}`
    : `wOceanCap=oceanCapCells(input.vOceanXZ,wOceanPixel,wWindShare);`;
  return /* wgsl */ `
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
let wF=WATER_F0+(1.0-WATER_F0)*pow(1.0-wNdV,5.0);
alpha=1.0-(1.0-wF)*exp(-2.0*wKdMean*wDepth);
let wOceanPixel=max(length(wOceanDx),length(wOceanDy));
let wFoamAge=oceanFoamLookAge(wOceanFoam.z);
let wOceanLace=oceanFoamCover(input.vOceanXZ,wOceanFoam.x,wOceanFoam.y,wOceanPixel);
var wOceanCap:f32;
${cap}
wOceanCap*=1.0-wOceanFoam.y;
var wFoam=max(wOceanLace,wOceanCap);
wFoam=oceanLipFoam(wFoam,wOceanLip,wOceanFoam.z);
let wFoamWhite=select(OCEAN_FOAM_ALBEDO,oceanFoamWhite(wFoamAge),wOceanLace>=wOceanCap);
surfaceAlbedo=mix(surfaceAlbedo,vec3<f32>(wFoamWhite),wFoam);
alpha=mix(alpha,1.0,wFoam);
N=normalize(mix(N,vec3<f32>(0.0,1.0,0.0),wFoam));
roughness=min(sqrt(sqrt(2.0*wOceanVar)),1.0);`;
}

/**
 * `waterCompose.fragment.fx` on the sea: the white water held matte; then
 * the lit colour summed again from its parts, which Lite has summed already
 * by this point.
 */
export const SEA_COMPOSE_WGSL = /* wgsl */ `
let wRadianceScaled=finalRadianceScaled*(1.0-wFoam);
let wSpecularScaled=finalSpecularScaled*(1.0-wFoam);
color=finalIrradiance+wRadianceScaled+wSpecularScaled+directDiffuse+emissive;`;
