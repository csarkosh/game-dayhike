${varyings}
@fragment fn mainFragment(input:FieldOut)->@location(0)vec4<f32>{
  let u=shaderUniforms;
  let vPlace=input.place;
  let vField=input.field;
  let up=vField.y;
  let standing=vField.z;
  let d=length(input.fromEye);
  let plan=vPlace.xz;
  let shapes=textureSample(wayNoise,wayNoiseSampler,plan*(1.0/11.0)+u.wayDrift.xy);
  let large=mix(0.6,shapes.r,smoothstep(0.0,4.0,d));
  let curl=(shapes.gr-0.5)*u.wayMove.y;
  let strata=vec2<f32>(dot(plan,vec2<f32>(0.8,0.6))/14.0,vPlace.y/4.0+dot(plan,vec2<f32>(-0.6,0.8))/22.0);
  var small=textureSample(wayNoise,wayNoiseSampler,mix(plan*0.25+up*vec2<f32>(0.37,0.19),strata,standing)-u.wayDrift.zw+curl).g;
  small=mix(0.6,small,smoothstep(1.6,8.0,d));
  let outside=smoothstep(u.wayFieldReach.x,u.wayFieldReach.y,vField.x);
  let heave=sin(dot(plan,vec2<f32>(0.31,0.22))-u.wayMove.z)*sin(dot(plan,vec2<f32>(-0.13,0.19))+u.wayMove.w);
  let lift=(0.5+0.7*large)*(1.0+u.wayMove.x*heave);
  let top=mix(u.wayFieldMist.z*lift,min(vField.w*lift,vField.w*u.wayHead),standing);
  let fall=1.0-smoothstep(0.0,1.0,up/max(top,0.01));
  let close=mix(0.3,1.0,smoothstep(1.0,10.0,d));
  let rim=1.0-smoothstep(u.wayFieldReach.z,u.wayFieldReach.w,d);
  let sheet=u.wayFieldMist.x*fall*mix(0.15,1.0,smoothstep(0.3,0.75,small));
  let fin=u.wayFieldMist.y*smoothstep(0.0,0.4,up)*fall*mix(0.15,1.0,small);
  let face=cross(dpdx(vPlace),dpdy(vPlace));
  let facing=abs(dot(face,input.fromEye))*inverseSqrt(max(dot(face,face),1.0e-20))/max(d,0.001);
  let edge=mix(smoothstep(0.04,0.25,facing),smoothstep(0.04,0.3,facing),standing);
  let amount=clamp(mix(sheet,fin,standing)*outside*close*rim*edge*smoothstep(0.3,2.0,d)*u.wayGain,0.0,1.0);
  return vec4<f32>(u.wayTint*amount,amount*u.wayFieldMist.w);
}
