/**
 * The post chain's passes in WGSL, for Babylon Lite: the game's fragment
 * shaders (`shaders/farSoft.fragment.fx`, `taa.fragment.fx`,
 * `taaSharpen.fragment.fx`, `paint.fragment.fx`, `paintCompose.fragment.fx`,
 * `halationExtract.fragment.fx`, `grade.fragment.fx`, `lens.fragment.fx`)
 * statement for statement, and how a pass's uniforms are laid out from the
 * record `postFrame.ts` makes of them.
 *
 * What differs from the GLSL is where a pass reads and writes, never what
 * it computes:
 *
 * - **A pass computes in the game's coordinates**, `vUV` counting up the
 *   frame from its foot, and turns it over only where it reads a texture
 *   (`tx`): a texture's rows count down from its top.
 * - **The depth is the frame's own.** The game draws each pixel's distance
 *   along the view as a second target of its scene's pass, four samples a
 *   pixel, resolved to their mean, 0 where nothing was drawn. Here the
 *   scene's pass has one target, and its depth buffer is read instead: a
 *   pass of four reads a pixel (`DEPTH_RESOLVE`) turns each sample's depth
 *   into its distance (Lite's depth runs from 1 at the near plane to 0 where
 *   nothing was drawn) and writes their mean, which the far softening and
 *   the anti-aliasing then read as the game's passes read theirs.
 * - **The compose is the grade's first statement.** The game's compose
 *   writes a frame that only the grade reads, each pixel at its own place,
 *   so the two are one pass here (`gradeWgsl`), and on the tier with the
 *   halation the extract makes the composed frame's four texels under each
 *   of its own for itself (`HALATION_EXTRACT`), as the bilinear read of the
 *   game's does.
 * - **What a frame does not show is not worked out.** The grade's shade
 *   block (seventeen reads of the mask) runs only while a figure is in the
 *   mask, its stare block only while the darkness has closed at all and the
 *   chase's cast only while it is in; the halation is read only on the tier
 *   that makes it. In the GLSL each is multiplied by its gate.
 *
 * Loads nothing.
 */
import { PAINT_REACH } from "../postParams.js";

/** A uniform's WGSL type by how many floats its record holds: nine are a 3 by 3 matrix, column by column. */
const TYPES: Readonly<Record<number, { type: string; align: number; size: number }>> = {
  1: { type: "f32", align: 4, size: 4 },
  2: { type: "vec2<f32>", align: 8, size: 8 },
  3: { type: "vec3<f32>", align: 16, size: 12 },
  4: { type: "vec4<f32>", align: 16, size: 16 },
  9: { type: "mat3x3<f32>", align: 16, size: 48 },
};

/** A pass's uniforms as WGSL lays them out: the struct's text, each field's offset in floats, and the struct's size in bytes. */
export type PassLayout = { readonly struct: string; readonly offsets: ReadonlyMap<string, number>; readonly bytes: number };

/** The layout of `record`'s fields, in the record's own order, as the struct `U`. */
export function passLayout(record: Readonly<Record<string, ArrayLike<number>>>): PassLayout {
  const offsets = new Map<string, number>();
  const fields: string[] = [];
  let at = 0;
  for (const [name, value] of Object.entries(record)) {
    const kind = TYPES[value.length];
    if (kind === undefined) throw new Error(`the uniform ${name} has ${value.length} floats, which no WGSL type holds`);
    at = Math.ceil(at / kind.align) * kind.align;
    offsets.set(name, at / 4);
    fields.push(`${name}:${kind.type}`);
    at += kind.size;
  }
  return { struct: `struct U{${fields.join(",")}}`, offsets, bytes: Math.max(16, Math.ceil(at / 16) * 16) };
}

/** Writes `record` into `data` from float `base` on, by `layout`: a matrix's columns three floats each, a column every four. */
export function writePass(data: Float32Array, base: number, layout: PassLayout, record: Readonly<Record<string, ArrayLike<number>>>): void {
  for (const name in record) {
    const offset = layout.offsets.get(name);
    if (offset === undefined) throw new Error(`no uniform ${name} in the pass's layout`);
    const value = record[name] as ArrayLike<number>;
    const at = base + offset;
    if (value.length === 9) {
      for (let column = 0; column < 3; column++) for (let row = 0; row < 3; row++) data[at + column * 4 + row] = value[column * 3 + row] as number;
    } else {
      for (let i = 0; i < value.length; i++) data[at + i] = value[i] as number;
    }
  }
}

/** The stage every pass shares: one triangle over the frame, `vUV` counting up from the frame's foot as the game's does. */
export const POST_VERTEX_WGSL = /* wgsl */ `
struct PostVertex{@builtin(position)position:vec4<f32>,@location(0)vUV:vec2<f32>}
@vertex fn postVertex(@builtin(vertex_index)i:u32)->PostVertex{
  var corners=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
  let c=corners[i];
  return PostVertex(vec4<f32>(c,0.0,1.0),c*0.5+0.5);
}
fn tx(uv:vec2<f32>)->vec2<f32>{return vec2<f32>(uv.x,1.0-uv.y);}`;

/**
 * The depth's resolve: each of a pixel's samples as its distance along the
 * view, `depthTerms.y / (d - depthTerms.x)` with the projection's two depth
 * terms, 0 where nothing was drawn, and their mean. `samples` is how many
 * samples a pixel the scene's pass has.
 */
export function depthResolveWgsl(samples: number): string {
  return /* wgsl */ `
@group(0)@binding(0)var<uniform>u:U;
@group(0)@binding(1)var depthSamples:texture_depth_multisampled_2d;
@fragment fn postFragment(input:PostVertex)->@location(0)vec4<f32>{
  let at=vec2<i32>(input.position.xy);
  var sum=0.0;
  for(var i:i32=0;i<${samples};i++){
    let d=textureLoad(depthSamples,at,i);
    if(d>0.0){sum+=u.depthTerms.y/(d-u.depthTerms.x);}
  }
  return vec4<f32>(sum/${samples}.0,0.0,0.0,1.0);
}`;
}

/** farSoft.fragment.fx. */
export const FAR_SOFT_WGSL = /* wgsl */ `
@group(0)@binding(0)var<uniform>u:U;
@group(0)@binding(1)var postSampler:sampler;
@group(0)@binding(2)var textureSampler:texture_2d<f32>;
@group(0)@binding(3)var depthSampler:texture_2d<f32>;
@group(0)@binding(4)var atmCloudMap:texture_2d<f32>;
@group(0)@binding(5)var atmCloudMapSampler:sampler;
const FAR_SOFT_SKY:f32=100000.0;
const ATM_CLOUD_EDGE:f32=0.5/64.0;
const ATM_CLOUD_STEPS_MAX:i32=12;
fn farDepth(uv:vec2<f32>)->f32{
  let d=textureSampleLevel(depthSampler,postSampler,tx(uv),0.0).r;
  return select(FAR_SOFT_SKY,d,d>0.0);
}
fn atmCloudGround(xz:vec2<f32>)->vec2<f32>{
  let uv=clamp((xz-u.atmCloudGroundRect.xy)*u.atmCloudGroundRect.z+0.5,vec2<f32>(ATM_CLOUD_EDGE),vec2<f32>(1.0-ATM_CLOUD_EDGE));
  let g=textureSampleLevel(atmCloudMap,atmCloudMapSampler,uv,0.0);
  return vec2<f32>(u.atmCloudGroundRect.w+g.b*u.atmCloudGroundRange,g.a);
}
fn atmCloudAt(p:vec3<f32>,s:f32)->f32{
  let ground=atmCloudGround(p.xz);
  let above=p.y-ground.x+u.atmCloudSeat;
  let h=exp(-max(above,0.0)*u.atmCloudFalloff)*mix(u.atmCloudTrail,1.0,ground.y);
  var large=textureSampleLevel(atmCloudMap,atmCloudMapSampler,p.xz*u.atmCloudNoiseScale.x+u.atmCloudWind,0.0).r;
  var small=textureSampleLevel(atmCloudMap,atmCloudMapSampler,(p.xz+vec2<f32>(p.y,-p.y)*0.7)*u.atmCloudNoiseScale.y-u.atmCloudWind.yx,0.0).g;
  large=mix(0.7,large,smoothstep(0.0,u.atmCloudNear*0.5,s));
  small=mix(0.7,small,smoothstep(u.atmCloudNear*0.2,u.atmCloudNear,s));
  let n=clamp(large*small*2.4-0.2,0.0,1.0);
  return u.atmCloudDensity*h*n;
}
fn atmCloudDepth(ro:vec3<f32>,rd:vec3<f32>,t:f32)->f32{
  let reach=min(t,u.atmCloudRange);
  var od=0.0;
  var prev=0.0;
  for(var i:i32=1;i<=ATM_CLOUD_STEPS_MAX;i++){
    if(f32(i)>u.atmCloudSteps){break;}
    let f=f32(i)/u.atmCloudSteps;
    let s=reach*f*f;
    let mid=0.5*(prev+s);
    od+=atmCloudAt(ro+rd*mid,mid)*(s-prev);
    prev=s;
  }
  return od;
}
fn farSoftened(uv:vec2<f32>,d:f32,c:vec3<f32>)->vec3<f32>{
  let r=smoothstep(u.soft.x,u.soft.y,d)*u.soft.z;
  if(r<0.2){return c;}
  var sum=c;
  var wsum=1.0;
  for(var i:i32=0;i<12;i++){
    let a=select(f32(i-8)*1.5707963+0.7853982,f32(i)*0.7853982,i<8);
    let ring=select(r*0.5,r,i<8);
    let o=vec2<f32>(cos(a),sin(a))*ring*u.texel;
    let dn=farDepth(uv+o);
    let w=step(d*0.8,dn);
    sum+=textureSampleLevel(textureSampler,postSampler,tx(uv+o),0.0).rgb*w;
    wsum+=w;
  }
  return sum/wsum;
}
@fragment fn postFragment(input:PostVertex)->@location(0)vec4<f32>{
  let vUV=input.vUV;
  let d=farDepth(vUV);
  let c=textureSampleLevel(textureSampler,postSampler,tx(vUV),0.0);
  var col=farSoftened(vUV,d,c.rgb);
  if(u.atmCloudSteps>0.5&&d<FAR_SOFT_SKY){
    let ndc=vUV*2.0-1.0;
    let rd=normalize(u.farForward+ndc.x*u.farRight+ndc.y*u.farUp);
    let t=d/max(dot(rd,u.farForward),1.0e-4);
    let od=atmCloudDepth(u.farEye,rd,t);
    let cloudGlow=pow(max(dot(rd,u.atmSunDir),0.0),u.atmCloudGlow.y)*u.atmCloudGlow.x;
    let cloud=u.atmCloudColour+u.atmSunColour*cloudGlow;
    col=mix(cloud,col,exp(-od));
  }
  return vec4<f32>(col,c.a);
}`;

/** taa.fragment.fx. */
export const TAA_WGSL = /* wgsl */ `
@group(0)@binding(0)var<uniform>u:U;
@group(0)@binding(1)var postSampler:sampler;
@group(0)@binding(2)var textureSampler:texture_2d<f32>;
@group(0)@binding(3)var historySampler:texture_2d<f32>;
@group(0)@binding(4)var depthSampler:texture_2d<f32>;
fn taaToYCoCg(c:vec3<f32>)->vec3<f32>{
  return vec3<f32>(0.25*c.r+0.5*c.g+0.25*c.b,0.5*c.r-0.5*c.b,-0.25*c.r+0.5*c.g-0.25*c.b);
}
fn taaFromYCoCg(c:vec3<f32>)->vec3<f32>{
  return vec3<f32>(c.x+c.y-c.z,c.x+c.z,c.x-c.y-c.z);
}
fn taaRead(uv:vec2<f32>)->vec3<f32>{return textureSampleLevel(historySampler,postSampler,tx(uv),0.0).rgb;}
fn taaHistory(uv:vec2<f32>)->vec3<f32>{
  let texel=u.texel;
  let pos=uv/texel;
  let tc1=floor(pos-0.5)+0.5;
  let f=pos-tc1;
  let w0=f*(-0.5+f*(1.0-0.5*f));
  let w1=1.0+f*f*(-2.5+1.5*f);
  let w2=f*(0.5+f*(2.0-1.5*f));
  let w3=f*f*(-0.5+0.5*f);
  let w12=w1+w2;
  let tc0=(tc1-1.0)*texel;
  let tc3=(tc1+2.0)*texel;
  let tc12=(tc1+w2/w12)*texel;
  let r=taaRead(vec2<f32>(tc12.x,tc0.y))*(w12.x*w0.y)
    +taaRead(vec2<f32>(tc0.x,tc12.y))*(w0.x*w12.y)
    +taaRead(tc12)*(w12.x*w12.y)
    +taaRead(vec2<f32>(tc3.x,tc12.y))*(w3.x*w12.y)
    +taaRead(vec2<f32>(tc12.x,tc3.y))*(w12.x*w3.y);
  let wsum=w12.x*w0.y+w0.x*w12.y+w12.x*w12.y+w3.x*w12.y+w12.x*w3.y;
  return max(r/wsum,vec3<f32>(0.0));
}
fn taaClip(p:vec3<f32>,lo:vec3<f32>,hi:vec3<f32>)->vec3<f32>{
  let centre=0.5*(hi+lo);
  let extent=0.5*(hi-lo)+1.0e-5;
  let v=p-centre;
  let q=abs(v/extent);
  let m=max(q.x,max(q.y,q.z));
  if(m>1.0){return centre+v/m;}
  return p;
}
@fragment fn postFragment(input:PostVertex)->@location(0)vec4<f32>{
  let vUV=input.vUV;
  let texel=u.texel;
  let cur=textureSampleLevel(textureSampler,postSampler,tx(vUV),0.0);
  var m1=vec3<f32>(0.0);
  var m2=vec3<f32>(0.0);
  var nmin=vec3<f32>(1.0e9);
  var nmax=vec3<f32>(-1.0e9);
  for(var y:i32=-1;y<=1;y++){
    for(var x:i32=-1;x<=1;x++){
      let s=taaToYCoCg(textureSampleLevel(textureSampler,postSampler,tx(vUV+vec2<f32>(f32(x),f32(y))*texel),0.0).rgb);
      m1+=s;
      m2+=s*s;
      nmin=min(nmin,s);
      nmax=max(nmax,s);
    }
  }
  let mean=m1/9.0;
  let sigma=sqrt(max(m2/9.0-mean*mean,vec3<f32>(0.0)));
  let lo=max(nmin,mean-u.taaParams.y*sigma);
  let hi=min(nmax,mean+u.taaParams.y*sigma);

  let d=textureSampleLevel(depthSampler,postSampler,tx(vUV),0.0).r;
  let ndc=vUV*2.0-1.0;
  let ray=u.taaForward+ndc.x*u.taaRight+ndc.y*u.taaUp;
  let v=select(ray,u.taaEye+ray*d-u.taaPrevEye,d>0.0);
  let z=dot(v,u.taaPrevForward);
  let pndc=vec2<f32>(dot(v,u.taaPrevRight)/dot(u.taaPrevRight,u.taaPrevRight),dot(v,u.taaPrevUp)/dot(u.taaPrevUp,u.taaPrevUp))/max(z,1.0e-4);
  let puv=pndc*0.5+0.5;
  let ok=u.taaParams.z*step(1.0e-4,z)*step(0.0,puv.x)*step(puv.x,1.0)*step(0.0,puv.y)*step(puv.y,1.0);

  let hist=taaFromYCoCg(taaClip(taaToYCoCg(taaHistory(clamp(puv,vec2<f32>(0.0),vec2<f32>(1.0)))),lo,hi));
  let blended=mix(hist,cur.rgb,u.taaParams.x);
  return vec4<f32>(mix(cur.rgb,blended,ok),cur.a);
}`;

/** taaSharpen.fragment.fx. */
export const TAA_SHARPEN_WGSL = /* wgsl */ `
@group(0)@binding(0)var<uniform>u:U;
@group(0)@binding(1)var postSampler:sampler;
@group(0)@binding(2)var textureSampler:texture_2d<f32>;
fn sharpenRead(uv:vec2<f32>)->vec4<f32>{return textureSampleLevel(textureSampler,postSampler,tx(uv),0.0);}
@fragment fn postFragment(input:PostVertex)->@location(0)vec4<f32>{
  let vUV=input.vUV;
  let c=sharpenRead(vUV);
  let n=sharpenRead(vUV+vec2<f32>(0.0,u.texel.y)).rgb;
  let s=sharpenRead(vUV-vec2<f32>(0.0,u.texel.y)).rgb;
  let e=sharpenRead(vUV+vec2<f32>(u.texel.x,0.0)).rgb;
  let w=sharpenRead(vUV-vec2<f32>(u.texel.x,0.0)).rgb;
  let lo=min(c.rgb,min(min(n,s),min(e,w)));
  let hi=max(c.rgb,max(max(n,s),max(e,w)));
  let lifted=c.rgb+u.sharpen*(c.rgb-0.25*(n+s+e+w));
  return vec4<f32>(clamp(lifted,lo,hi),c.a);
}`;

/** paint.fragment.fx: its eight sectors' sums as arrays, where the GLSL names each. */
export const PAINT_WGSL = /* wgsl */ `
@group(0)@binding(0)var<uniform>u:U;
@group(0)@binding(1)var postSampler:sampler;
@group(0)@binding(2)var textureSampler:texture_2d<f32>;
const PAINT_REACH:i32=${PAINT_REACH};
const PAINT_SECTOR_OVERLAP:f32=0.5;
const PAINT_SECTOR_SPREAD:f32=2.5;
const PAINT_SHARPNESS:f32=8.0;
const PAINT_VARIANCE_SCALE:f32=40.0;
const PAINT_KEEP:f32=24.0;
const PAINT_CAP:f32=64.0;
const PAINT_DIRS:array<vec2<f32>,8>=array<vec2<f32>,8>(
  vec2<f32>(1.0,0.0),vec2<f32>(0.70710678,0.70710678),vec2<f32>(0.0,1.0),vec2<f32>(-0.70710678,0.70710678),
  vec2<f32>(-1.0,0.0),vec2<f32>(-0.70710678,-0.70710678),vec2<f32>(0.0,-1.0),vec2<f32>(0.70710678,-0.70710678));
fn paintLuma(c:vec3<f32>)->f32{
  return dot(c,vec3<f32>(0.2126,0.7152,0.0722));
}
fn paintCompress(c:vec3<f32>)->vec3<f32>{
  return c/(1.0+c);
}
@fragment fn postFragment(input:PostVertex)->@location(0)vec4<f32>{
  let vUV=input.vUV;
  let ownLinear=clamp(textureSampleLevel(textureSampler,postSampler,tx(vUV),0.0).rgb,vec3<f32>(0.0),vec3<f32>(PAINT_CAP));
  let own=paintCompress(ownLinear);
  let r=clamp(u.radius,0.5,f32(PAINT_REACH));
  let zeta=2.0/r;
  let reach=i32(ceil(r));
  var dirs=PAINT_DIRS;
  var mean:array<vec3<f32>,8>;
  var meanLinear:array<vec3<f32>,8>;
  var square:array<vec3<f32>,8>;
  var weight:array<f32,8>;
  for(var j:i32=-reach;j<=reach;j++){
    for(var i:i32=-reach;i<=reach;i++){
      let o=vec2<f32>(f32(i),f32(j));
      if(dot(o,o)>r*r){continue;}
      let v=o/r;
      let fall=exp(-PAINT_SECTOR_SPREAD*dot(v,v));
      let cLinear=clamp(textureSampleLevel(textureSampler,postSampler,tx(vUV+o*u.texel),0.0).rgb,vec3<f32>(0.0),vec3<f32>(PAINT_CAP));
      let c=paintCompress(cLinear);
      for(var k:i32=0;k<8;k++){
        let dir=dirs[k];
        let along=dot(v,dir);
        let across=dot(v,vec2<f32>(-dir.y,dir.x));
        var s=max(0.0,along+zeta-PAINT_SECTOR_OVERLAP*across*across);
        s=s*s*fall;
        mean[k]+=c*s;
        meanLinear[k]+=cLinear*s;
        square[k]+=c*c*s;
        weight[k]+=s;
      }
    }
  }
  var sum=vec3<f32>(0.0);
  var total=0.0;
  for(var k:i32=0;k<8;k++){
    let wk=max(weight[k],1.0e-5);
    let m=mean[k]/wk;
    let s=max(square[k]/wk-m*m,vec3<f32>(0.0));
    let sigma=sqrt(paintLuma(s));
    var w=1.0/(1.0+pow(PAINT_VARIANCE_SCALE*sigma,PAINT_SHARPNESS));
    let away=m-own;
    w*=exp(-PAINT_KEEP*dot(away,away));
    sum+=(meanLinear[k]/wk)*w;
    total+=w;
  }
  var painted=ownLinear;
  if(total>1.0e-6){painted=sum/total;}
  return vec4<f32>(painted,1.0);
}`;

/**
 * paintCompose.fragment.fx as a function of the place: `composed(uv)` is
 * the pixel the game's compose writes there, from the strokes
 * (`paintSampler`, the GLSL's `textureSampler`) and the frame they were
 * painted from (`sceneSampler`).
 */
const COMPOSE_WGSL = /* wgsl */ `
const PAINT_CAP:f32=64.0;
const PAINT_JOINT_SHARPNESS:f32=60.0;
fn composeCompress(c:vec3<f32>)->vec3<f32>{
  return c/(1.0+c);
}
fn composeScene(uv:vec2<f32>)->vec3<f32>{
  return clamp(textureSampleLevel(sceneSampler,postSampler,tx(uv),0.0).rgb,vec3<f32>(0.0),vec3<f32>(PAINT_CAP));
}
fn composeWeight(bilinear:f32,at:vec3<f32>,guide:vec3<f32>)->f32{
  let d=composeCompress(at)-guide;
  return bilinear*exp(-PAINT_JOINT_SHARPNESS*dot(d,d))+1.0e-5;
}
fn composePaint(uv:vec2<f32>)->vec3<f32>{return textureSampleLevel(paintSampler,postSampler,tx(uv),0.0).rgb;}
fn composed(vUV:vec2<f32>)->vec3<f32>{
  let scene=composeScene(vUV);
  let guide=composeCompress(scene);
  let p=vUV/u.halfTexel-0.5;
  let base=floor(p);
  let f=p-base;
  let c00=(base+vec2<f32>(0.5,0.5))*u.halfTexel;
  let c10=(base+vec2<f32>(1.5,0.5))*u.halfTexel;
  let c01=(base+vec2<f32>(0.5,1.5))*u.halfTexel;
  let c11=(base+vec2<f32>(1.5,1.5))*u.halfTexel;
  let w00=composeWeight((1.0-f.x)*(1.0-f.y),composeScene(c00),guide);
  let w10=composeWeight(f.x*(1.0-f.y),composeScene(c10),guide);
  let w01=composeWeight((1.0-f.x)*f.y,composeScene(c01),guide);
  let w11=composeWeight(f.x*f.y,composeScene(c11),guide);
  let painted=(composePaint(c00)*w00+composePaint(c10)*w10+composePaint(c01)*w01+composePaint(c11)*w11)/(w00+w10+w01+w11);
  return mix(scene,painted,u.strength);
}`;

/**
 * halationExtract.fragment.fx, at a quarter of the frame on each axis. The
 * game's reads the composed frame once, bilinearly, at its own texel's
 * centre, which is the mean of the four composed texels round it; here
 * those four are composed in place (`texel` is the full frame's).
 */
export const HALATION_EXTRACT_WGSL = /* wgsl */ `
@group(0)@binding(0)var<uniform>u:U;
@group(0)@binding(1)var postSampler:sampler;
@group(0)@binding(2)var sceneSampler:texture_2d<f32>;
@group(0)@binding(3)var paintSampler:texture_2d<f32>;
${COMPOSE_WGSL}
const HALATION_THRESHOLD:f32=1.0;
const HALATION_CAP:f32=4.0;
const HALATION_TINT:vec3<f32>=vec3<f32>(1.0,0.45,0.2);
fn halationLuma(c:vec3<f32>)->f32{
  return dot(c,vec3<f32>(0.2126,0.7152,0.0722));
}
@fragment fn postFragment(input:PostVertex)->@location(0)vec4<f32>{
  let vUV=input.vUV;
  let h=0.5*u.texel;
  let frame=0.25*(composed(vUV+vec2<f32>(-h.x,-h.y))+composed(vUV+vec2<f32>(h.x,-h.y))+composed(vUV+vec2<f32>(-h.x,h.y))+composed(vUV+vec2<f32>(h.x,h.y)));
  let exposed=frame*u.exposure;
  let l=halationLuma(exposed);
  let over=clamp(l-HALATION_THRESHOLD,0.0,HALATION_CAP)/HALATION_CAP;
  return vec4<f32>(exposed/max(l,1.0e-4)*HALATION_TINT*over,1.0);
}`;

/** The kernel Babylon.js's blur pass takes for the one it is asked for: the nearest odd one whose half is even, so its taps pair up either side of the centre. */
export function blurKernel(ideal: number): number {
  const v = Math.round(Math.max(ideal, 1));
  for (const k of [v, v - 1, v + 1, v - 2, v + 2]) {
    if (k % 2 !== 0 && Math.floor(k / 2) % 2 === 0 && k > 0) return Math.max(k, 3);
  }
  return Math.max(v, 3);
}

/** A blur's reads, in texels from the centre along its axis, and the weight of each, as Babylon.js's blur pass makes them for `kernel`. */
export function blurTaps(kernel: number): { offsets: number[]; weights: number[] } {
  // Babylon.js's `BlurPostProcess`: a Gaussian of sigma a third of the kernel's half-width, its weights summing to
  // one, neighbouring taps joined into one linear read each.
  const n = blurKernel(kernel);
  const centre = (n - 1) / 2;
  const gaussian = (x: number): number => {
    const sigma = 1 / 3;
    const denominator = Math.sqrt(2.0 * Math.PI) * sigma;
    const exponent = -((x * x) / (2.0 * sigma * sigma));
    return (1.0 / denominator) * Math.exp(exponent);
  };
  let offsets: number[] = [];
  let weights: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const w = gaussian(u * 2.0 - 1);
    offsets[i] = i - centre;
    weights[i] = w;
    total += w;
  }
  for (let i = 0; i < weights.length; i++) weights[i] = (weights[i] as number) / total;
  // Pairs either side of the centre become one read between them, by their weights.
  const linearOffsets: number[] = [];
  const linearWeights: number[] = [];
  const merged: [number, number][] = [];
  for (let i = 0; i <= centre; i += 2) {
    const j = Math.min(i + 1, Math.floor(centre));
    if (i === j) merged.push([offsets[i] as number, weights[i] as number]);
    else {
      const shared = j === centre;
      const weightLinear = (weights[i] as number) + (weights[j] as number) * (shared ? 0.5 : 1.0);
      const offsetLinear = (offsets[i] as number) + 1 / (1 + (weights[i] as number) / (weights[j] as number));
      if (offsetLinear === 0) {
        merged.push([offsets[i] as number, weights[i] as number]);
        merged.push([(offsets[i] as number) + 1, weights[i + 1] as number]);
      } else {
        merged.push([offsetLinear, weightLinear]);
        merged.push([-offsetLinear, weightLinear]);
      }
    }
  }
  for (const [o, w] of merged) {
    linearOffsets.push(o);
    linearWeights.push(w);
  }
  offsets = linearOffsets;
  weights = linearWeights;
  return { offsets, weights };
}

/** A blur pass along `delta` (a texel along its axis): Babylon.js's kernel blur, its taps as `blurTaps` gives them. */
export function blurWgsl(kernel: number): string {
  const { offsets, weights } = blurTaps(kernel);
  // Eight decimals each, as Babylon.js writes them into its shader.
  const taps = offsets.map((o, i) => `  blend+=textureSampleLevel(textureSampler,postSampler,tx(vUV+u.delta*${o.toFixed(8)}),0.0)*${(weights[i] as number).toFixed(8)};`).join("\n");
  return /* wgsl */ `
@group(0)@binding(0)var<uniform>u:U;
@group(0)@binding(1)var postSampler:sampler;
@group(0)@binding(2)var textureSampler:texture_2d<f32>;
@fragment fn postFragment(input:PostVertex)->@location(0)vec4<f32>{
  let vUV=input.vUV;
  var blend=vec4<f32>(0.0);
${taps}
  return blend;
}`;
}

/**
 * grade.fragment.fx, the compose ahead of it. `halation`: the tier makes a
 * halation, read from `halationSampler`; without it the GLSL screens the
 * frame with black, which changes nothing, and nothing is read here.
 */
export function gradeWgsl(halation: boolean): string {
  return /* wgsl */ `
@group(0)@binding(0)var<uniform>u:U;
@group(0)@binding(1)var postSampler:sampler;
@group(0)@binding(2)var sceneSampler:texture_2d<f32>;
@group(0)@binding(3)var paintSampler:texture_2d<f32>;
@group(0)@binding(4)var shadeSampler:texture_2d<f32>;
${halation ? "@group(0)@binding(5)var halationSampler:texture_2d<f32>;" : ""}
${COMPOSE_WGSL}
const DITHER_LSB:f32=0.00392156862745098;
fn gradeNoise(p:vec2<f32>,seed:f32)->f32{
  return fract(52.9829189*fract(0.06711056*p.x+0.00583715*p.y+seed));
}
const SRGB_TO_REC2020:mat3x3<f32>=mat3x3<f32>(0.6274,0.0691,0.0164,0.3293,0.9195,0.088,0.0433,0.0113,0.8956);
const REC2020_TO_SRGB:mat3x3<f32>=mat3x3<f32>(1.6605,-0.1246,-0.0182,-0.5876,1.1329,-0.1006,-0.0728,-0.0083,1.1187);
const AGX_INSET:mat3x3<f32>=mat3x3<f32>(0.856627153315983,0.137318972929847,0.11189821299995,0.0951212405381588,0.761241990602591,0.0767994186031903,0.0482516061458583,0.101439036467562,0.811302368396859);
const AGX_OUTSET:mat3x3<f32>=mat3x3<f32>(1.1271005818144368,-0.1413297634984383,-0.14132976349843826,-0.11060664309660323,1.157823702216272,-0.11060664309660294,-0.016493938717834573,-0.016493938717834257,1.2519364065950405);
const AGX_MIN_EV:f32=-12.47393;
const AGX_MAX_EV:f32=4.026069;
const SPLIT_TONE_DENSITY_SCALE:f32=0.35;
const SPLIT_TONE_SATURATION_SCALE:f32=0.5;
fn gradeLuma(c:vec3<f32>)->f32{
  return dot(c,vec3<f32>(0.2126,0.7152,0.0722));
}
fn agxContrast(x:vec3<f32>)->vec3<f32>{
  let x2=x*x;
  let x4=x2*x2;
  return 15.5*x4*x2-40.14*x4*x+31.96*x4-6.868*x2*x+0.4298*x2+0.1191*x-0.00232;
}
fn agxToneMap(c:vec3<f32>)->vec3<f32>{
  var v=AGX_INSET*(SRGB_TO_REC2020*c);
  v=max(v,vec3<f32>(1.0e-10));
  v=(log2(v)-AGX_MIN_EV)/(AGX_MAX_EV-AGX_MIN_EV);
  v=clamp(v,vec3<f32>(0.0),vec3<f32>(1.0));
  v=agxContrast(v);
  v=AGX_OUTSET*v;
  v=pow(max(v,vec3<f32>(0.0)),vec3<f32>(2.2));
  v=REC2020_TO_SRGB*v;
  return clamp(v,vec3<f32>(0.0),vec3<f32>(1.0));
}
fn gradeBand(c:vec3<f32>,mask:f32,tintColour:vec3<f32>,amount:vec2<f32>)->vec3<f32>{
  let l=gradeLuma(c);
  let tinted=mix(c,tintColour*l,amount.x*SPLIT_TONE_DENSITY_SCALE);
  let grey=vec3<f32>(gradeLuma(tinted));
  let sat=mix(grey,tinted,1.0+amount.y*SPLIT_TONE_SATURATION_SCALE);
  return mix(c,sat,mask);
}
fn shadeHash(p:vec2<f32>)->f32{
  return fract(sin(dot(p,vec2<f32>(127.1,311.7)))*43758.5453);
}
fn shadeNoise(p:vec2<f32>)->f32{
  let i=floor(p);
  var f=fract(p);
  f=f*f*(3.0-2.0*f);
  let a=shadeHash(i);
  let b=shadeHash(i+vec2<f32>(1.0,0.0));
  let c=shadeHash(i+vec2<f32>(0.0,1.0));
  let d=shadeHash(i+vec2<f32>(1.0,1.0));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
fn shadeRead(uv:vec2<f32>)->vec3<f32>{return textureSampleLevel(shadeSampler,postSampler,tx(uv),0.0).rgb;}
fn toSrgb(c:vec3<f32>)->vec3<f32>{
  return pow(c,vec3<f32>(1.0/2.2));
}
@fragment fn postFragment(input:PostVertex)->@location(0)vec4<f32>{
  let vUV=input.vUV;
  var c=composed(vUV)*u.exposure;
  c=agxToneMap(c);
  c=clamp(u.whitePoint*c,vec3<f32>(0.0),vec3<f32>(1.0));
  let l=gradeLuma(c);
  let rod=(1.0-smoothstep(0.0,u.purkinjeThreshold,l))*u.purkinjeStrength;
  c=mix(c,u.purkinje*c,rod);
  let shadowMask=1.0-smoothstep(0.0,0.35,l);
  let highlightMask=smoothstep(0.55,1.0,l);
  let midMask=1.0-shadowMask-highlightMask;
  c=gradeBand(c,shadowMask,u.paintShadowTint,u.paintShadowAmount);
  c=gradeBand(c,midMask,u.paintMidtoneTint,u.paintMidtoneAmount);
  c=gradeBand(c,highlightMask,u.paintHighlightTint,u.paintHighlightAmount);
  c=mix(vec3<f32>(gradeLuma(c)),c,1.0+u.paintSaturation);
  let paintLuma=gradeLuma(c);
  let paintLit=smoothstep(0.02,0.25,paintLuma)*(1.0-smoothstep(0.55,0.9,paintLuma));
  c=clamp(c+(c-u.paintCurve.y)*(u.paintCurve.x-1.0)*paintLit,vec3<f32>(0.0),vec3<f32>(1.0));
  c=u.paintLift+c*(1.0-u.paintLift);
  c=gradeBand(c,shadowMask,u.shadowTint,u.shadowAmount);
  c=gradeBand(c,midMask,u.midtoneTint,u.midtoneAmount);
  c=gradeBand(c,highlightMask,u.highlightTint,u.highlightAmount);
  c=mix(vec3<f32>(gradeLuma(c)),c,1.0+u.saturation);
  c=u.lift+c*(1.0-u.lift);
  if(u.chaseTint.w>0.0){
    c=mix(c,c*u.chaseTint.xyz+u.chaseLift,u.chaseTint.w);
  }
  if(u.shadeShape.w>0.0){
    let shadeStep=vec2<f32>(u.shadeShape.x,u.shadeShape.x*u.shadeShape.z);
    var shadeInner=shadeRead(vUV)*2.0;
    shadeInner+=shadeRead(vUV+shadeStep*vec2<f32>(0.5,0.0));
    shadeInner+=shadeRead(vUV+shadeStep*vec2<f32>(-0.5,0.0));
    shadeInner+=shadeRead(vUV+shadeStep*vec2<f32>(0.0,0.5));
    shadeInner+=shadeRead(vUV+shadeStep*vec2<f32>(0.0,-0.5));
    shadeInner+=shadeRead(vUV+shadeStep*vec2<f32>(0.35,0.35));
    shadeInner+=shadeRead(vUV+shadeStep*vec2<f32>(-0.35,0.35));
    shadeInner+=shadeRead(vUV+shadeStep*vec2<f32>(0.35,-0.35));
    shadeInner+=shadeRead(vUV+shadeStep*vec2<f32>(-0.35,-0.35));
    var shadeOuter=shadeRead(vUV+shadeStep*vec2<f32>(1.0,0.0));
    shadeOuter+=shadeRead(vUV+shadeStep*vec2<f32>(-1.0,0.0));
    shadeOuter+=shadeRead(vUV+shadeStep*vec2<f32>(0.0,1.0));
    shadeOuter+=shadeRead(vUV+shadeStep*vec2<f32>(0.0,-1.0));
    shadeOuter+=shadeRead(vUV+shadeStep*vec2<f32>(0.7,0.7));
    shadeOuter+=shadeRead(vUV+shadeStep*vec2<f32>(-0.7,0.7));
    shadeOuter+=shadeRead(vUV+shadeStep*vec2<f32>(0.7,-0.7));
    shadeOuter+=shadeRead(vUV+shadeStep*vec2<f32>(-0.7,-0.7));
    let shadeRGB=(shadeInner+shadeOuter)*u.shadeShape.w/18.0;
    let shadeReal=shadeInner.z*u.shadeShape.w/10.0;
    let shadeFigure=shadeRGB.x+shadeRGB.z;
    let shadeGone=shadeRGB.y/max(shadeFigure,1.0e-4);
    let shadeBlot=shadeNoise(vUV*vec2<f32>(u.shadeShape.z,1.0)*9.0+u.stareShade.w*0.12);
    let shadeKeep=smoothstep(shadeGone-0.35,shadeGone+0.05,shadeBlot);
    c*=1.0-min(1.0,shadeRGB.x*u.shadeShape.y+shadeReal*u.shadeMonster)*shadeKeep;
  }
  let centred=(vUV-0.5)*2.0;
  let vr=length(centred)/1.41421356;
  let vig=1.0-smoothstep(0.55,1.0,vr)*clamp(u.vignetteWeight*0.22,0.0,0.8);
  c=mix(u.vignetteColour,c,vig);
${halation ? `  let halo=textureSampleLevel(halationSampler,postSampler,tx(vUV),0.0).rgb*u.halationStrength;
  c=1.0-(1.0-c)*(1.0-clamp(halo,vec3<f32>(0.0),vec3<f32>(1.0)));` : ""}
  if(u.stareShade.z>0.0){
    let sp=centred-u.stareShade.xy;
    let sa=atan2(sp.y,sp.x);
    let st=u.stareShade.w;
    let crawl=0.5*sin(sa*2.0+st*0.37)+0.3*sin(sa*3.0-st*0.56+1.7)+0.2*sin(sa*7.0+st*0.94+4.1);
    let sr=length(sp)/1.41421356+crawl*0.11*u.stareShade.z;
    let openTo=mix(1.25,0.3,u.stareShade.z);
    let dark=smoothstep(openTo-0.42,openTo+0.14,sr)*min(1.0,u.stareShade.z*3.0);
    c*=1.0-0.97*dark;
  }
  var shown=toSrgb(clamp(c,vec3<f32>(0.0),vec3<f32>(1.0)));
  let pixel=vUV/u.texelSize;
  let d1=gradeNoise(pixel,fract(u.time*3.17));
  let d2=gradeNoise(pixel+vec2<f32>(37.0,11.0),fract(u.time*5.03));
  shown+=(d1+d2-1.0)*DITHER_LSB;
  return vec4<f32>(clamp(shown,vec3<f32>(0.0),vec3<f32>(1.0)),1.0);
}`;
}

/** lens.fragment.fx. */
export const LENS_WGSL = /* wgsl */ `
@group(0)@binding(0)var<uniform>u:U;
@group(0)@binding(1)var postSampler:sampler;
@group(0)@binding(2)var textureSampler:texture_2d<f32>;
@group(0)@binding(3)var lensSampler:texture_2d<f32>;
@group(0)@binding(4)var lensRepeat:sampler;
const LENS_TILES:f32=2.0;
const LENS_OFFSET:f32=0.012;
const LENS_COLUMNS:f32=8.0;
const LENS_JITTER:f32=0.05;
const SLIDE_RADIUS:f32=0.025;
const SLIDE_TRAIL:f32=0.2;
const SLIDE_CAP:f32=0.8;
const FOLD:f32=3600.0;
const FROST_TEXELS:f32=2.0;
const FOG_GAIN:f32=0.25;
fn lensHash(p:vec2<f32>)->f32{
  return fract(52.9829189*fract(0.06711056*p.x+0.00583715*p.y));
}
fn lensScene(uv:vec2<f32>)->vec4<f32>{return textureSampleLevel(textureSampler,postSampler,tx(uv),0.0);}
@fragment fn postFragment(input:PostVertex)->@location(0)vec4<f32>{
  let vUV=input.vUV;
  let frame=vec2<f32>(vUV.x*u.aspect,vUV.y)*LENS_TILES;
  let cell=floor(frame);
  let inTile=frame-cell;
  let flip=step(0.5,lensHash(cell+vec2<f32>(17.0,31.0)));
  let tileX=mix(inTile.x,1.0-inTile.x,flip);
  let shift=(vec2<f32>(lensHash(cell+vec2<f32>(5.0,7.0)),lensHash(cell+vec2<f32>(11.0,13.0)))-0.5)*2.0*LENS_JITTER;
  let d=textureSampleLevel(lensSampler,lensRepeat,vec2<f32>(tileX,inTile.y)+shift,0.0);
  let nStatic=(d.rg*2.0-1.0)*vec2<f32>(1.0-2.0*flip,1.0)*d.b;

  let column=floor(vUV.x*LENS_COLUMNS);
  let speed=floor((0.1+0.15*lensHash(vec2<f32>(column,3.0)))*FOLD)/FOLD;
  let run=u.time*speed+lensHash(vec2<f32>(column,5.0));
  let cycle=floor(run);
  let present=step(0.45,lensHash(vec2<f32>(column,cycle)));
  let yDrop=1.0+SLIDE_RADIUS-fract(run)*(1.0+2.0*SLIDE_RADIUS+SLIDE_TRAIL);
  let xDrop=(column+0.5+0.5*(lensHash(vec2<f32>(column,cycle+100.0))-0.5))/LENS_COLUMNS
    +0.004*sin(yDrop*50.0+column);
  let toDrop=vec2<f32>((vUV.x-xDrop)*u.aspect,vUV.y-yDrop);
  let q=length(toDrop)/SLIDE_RADIUS;
  let mSlide=(1.0-smoothstep(0.8,1.0,q))*present;
  let nSlide=toDrop/SLIDE_RADIUS*SLIDE_CAP*mSlide;
  let above=toDrop.y;
  let tSlide=(1.0-smoothstep(0.0,SLIDE_TRAIL,above))*step(0.0,above)
    *(1.0-smoothstep(0.3,0.5,abs(toDrop.x)/SLIDE_RADIUS))*present;

  let mask=max(d.b,mSlide);
  let trail=max(d.a,tSlide);
  let n=nStatic+nSlide;
  let uvR=vUV-u.lensStrength*LENS_OFFSET*vec2<f32>(n.x/u.aspect,n.y);
  let col=lensScene(uvR);
  let step2=u.texelSize*FROST_TEXELS;
  let soft=0.25*(
    lensScene(uvR+step2)
    +lensScene(uvR-step2)
    +lensScene(uvR+vec2<f32>(step2.x,-step2.y))
    +lensScene(uvR+vec2<f32>(-step2.x,step2.y)));
  let fog=u.lensStrength*(1.0-mask)*(1.0-trail)*FOG_GAIN;
  return mix(col,soft,fog);
}`;
