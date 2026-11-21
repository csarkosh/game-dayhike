
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
}
