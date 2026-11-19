
@group(0)@binding(0)var<uniform>u:U;
@group(0)@binding(1)var postSampler:sampler;
@group(0)@binding(2)var textureSampler:texture_2d<f32>;
const PAINT_REACH:i32=${paintReach};
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
}
