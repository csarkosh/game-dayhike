
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
}
