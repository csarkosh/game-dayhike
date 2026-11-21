
fn atmCloudGround(xz:vec2<f32>)->vec2<f32>{
  let uv=clamp((xz-material.atmCloudGroundRect.xy)*material.atmCloudGroundRect.z+0.5,vec2<f32>(ATM_CLOUD_EDGE),vec2<f32>(1.0-ATM_CLOUD_EDGE));
  let g=textureSampleLevel(atmCloudMap,atmCloudMapSampler,uv,0.0);
  return vec2<f32>(material.atmCloudGroundRect.w+g.b*material.atmCloudGroundRange,g.a);
}
fn atmCloudAt(p:vec3<f32>,s:f32)->f32{
  let ground=atmCloudGround(p.xz);
  let above=p.y-ground.x+material.atmCloudSeat;
  let h=exp(-max(above,0.0)*material.atmCloudFalloff)*mix(material.atmCloudTrail,1.0,ground.y);
  var large=textureSampleLevel(atmCloudMap,atmCloudMapSampler,p.xz*material.atmCloudNoiseScale.x+material.atmCloudWind,0.0).r;
  var small=textureSampleLevel(atmCloudMap,atmCloudMapSampler,(p.xz+vec2<f32>(p.y,-p.y)*0.7)*material.atmCloudNoiseScale.y-material.atmCloudWind.yx,0.0).g;
  large=mix(0.7,large,smoothstep(0.0,material.atmCloudNear*0.5,s));
  small=mix(0.7,small,smoothstep(material.atmCloudNear*0.2,material.atmCloudNear,s));
  let n=clamp(large*small*2.4-0.2,0.0,1.0);
  return material.atmCloudDensity*h*n;
}
fn atmCloudDepth(ro:vec3<f32>,rd:vec3<f32>,t:f32)->f32{
  let reach=min(t,material.atmCloudRange);
  var od=0.0;
  var prev=0.0;
  for(var i:i32=1;i<=ATM_CLOUD_STEPS_MAX;i++){
    if(f32(i)>material.atmCloudSteps){break;}
    let f=f32(i)/material.atmCloudSteps;
    let s=reach*f*f;
    let mid=0.5*(prev+s);
    od+=atmCloudAt(ro+rd*mid,mid)*(s-prev);
    prev=s;
  }
  return od;
}
