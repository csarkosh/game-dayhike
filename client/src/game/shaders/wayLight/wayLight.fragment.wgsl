${varyings}
@fragment fn mainFragment(input:WayOut)->@location(0)vec4<f32>{
  let u=shaderUniforms;
  let vPlace=input.place;
  let vWay=input.way;
  let lateral=vWay.x;
  let up=vWay.y;
  let standing=min(vWay.z,1.0);
  let isFin=step(1.5,vWay.z);
  let isSheet=(1.0-standing)*step(0.1,up);
  let d=length(input.fromEye);
  let plan=vPlace.xz;
  let shapes=textureSample(wayNoise,wayNoiseSampler,plan*(1.0/11.0)+u.wayDrift.xy);
  var large=shapes.r;
  let curl=(shapes.gr-0.5)*u.wayMove.y;
  let strata=vec2<f32>(dot(plan,vec2<f32>(0.8,0.6))/14.0,vPlace.y/u.wayStrata+dot(plan,vec2<f32>(-0.6,0.8))/22.0);
  var small=textureSample(wayNoise,wayNoiseSampler,mix(plan*0.25+up*vec2<f32>(0.37,0.19),strata,standing)-u.wayDrift.zw+curl).g;
  large=mix(0.6,large,smoothstep(0.0,4.0,d));
  small=mix(0.6,small,smoothstep(1.6,8.0,d));
  let bank=smoothstep(u.wayEdge.x,u.wayEdge.y,lateral);
  let band=mix(u.wayPath.x,1.0,bank)*(1.0-smoothstep(u.wayEdge.z,u.wayEdge.w,lateral));
  let core=1.0-smoothstep(u.wayEdge.x,u.wayEdge.y,lateral);
  let close=mix(u.wayPath.z,1.0,smoothstep(1.0,10.0,d));
  let far=exp(-u.wayGround.w*d);
  let heave=sin(dot(plan,vec2<f32>(0.31,0.22))-u.wayMove.z)*sin(dot(plan,vec2<f32>(-0.13,0.19))+u.wayMove.w);
  let top=min(mix(u.wayPath.y,vWay.w,bank)*(0.5+0.7*large)*(1.0+u.wayMove.x*heave),mix(1.0e6,vWay.w*u.wayHead,standing));
  let fall=1.0-smoothstep(0.0,1.0,up/max(top,0.01));
  let ground=(u.wayGround.y*core+u.wayGround.x*band*(0.35+0.65*large)*close)*exp(-u.wayGround.z*d);
  let veil=u.wayMist.x*band*smoothstep(0.0,0.4,up)*fall*mix(u.wayPath.w,1.0,small)*mix(1.0,u.wayMist.y,isFin)*close*far;
  let sheet=u.wayMist.z*band*fall*mix(u.wayPath.w,1.0,smoothstep(0.3,0.75,small))*close*far;
  let face=cross(dpdx(vPlace),dpdy(vPlace));
  let facing=abs(dot(face,input.fromEye))*inverseSqrt(max(dot(face,face),1.0e-20))/max(d,0.001);
  let edge=mix(mix(1.0,smoothstep(0.04,0.25,facing),isSheet),smoothstep(0.04,0.3,facing),isFin);
  let amount=clamp(mix(mix(ground,sheet,isSheet),veil,standing)*edge*smoothstep(0.3,2.0,d)*u.wayGain,0.0,1.0);
  return vec4<f32>(u.wayTint*amount,amount*u.wayMist.w);
}
