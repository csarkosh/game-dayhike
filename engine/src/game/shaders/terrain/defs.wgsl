
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
}
