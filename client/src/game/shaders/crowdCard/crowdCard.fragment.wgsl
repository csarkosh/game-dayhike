${varyings}
fn crowdLimb(p:vec2<f32>,a:vec2<f32>,b:vec2<f32>)->f32{
  let pa=p-a;
  let ba=b-a;
  return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0));
}
@fragment fn mainFragment(input:CardOut)->@location(0)vec4<f32>{
  let u=shaderUniforms;
  let vCard=input.card;
  let vStir=input.stir;
  var p=vec2<f32>(vCard.x*0.25,vCard.y);
  p.x-=sin(u.crowdTime*vStir.y+vStir.x)*0.012*p.y;
  let q=vec2<f32>(abs(p.x),p.y);
  var d=crowdLimb(q,vec2<f32>(0.0,0.44),vec2<f32>(0.0,0.66))-mix(0.07,0.1,smoothstep(0.44,0.66,q.y));
  d=min(d,length(q-vec2<f32>(0.0,0.755))-0.05);
  d=min(d,crowdLimb(q,vec2<f32>(0.045,0.44),vec2<f32>(0.06,0.0))-0.034);
  d=min(d,crowdLimb(q,vec2<f32>(0.105,0.64),vec2<f32>(0.135,0.33))-0.024);
  d=min(d,crowdLimb(q,vec2<f32>(0.03,0.79),vec2<f32>(0.085,0.9))-0.011);
  d=min(d,crowdLimb(q,vec2<f32>(0.085,0.9),vec2<f32>(0.07,0.985))-0.008);
  d=min(d,crowdLimb(q,vec2<f32>(0.06,0.85),vec2<f32>(0.125,0.92))-0.008);
  let body=1.0-smoothstep(-0.02,0.045,d);
  let feet=smoothstep(0.0,0.14,p.y);
  let shape=body*feet*vCard.w;
  let rim=1.0-smoothstep(0.0,0.06,abs(d+0.02));
  let inMask=vec4<f32>(1.0,0.0,0.0,shape);
  let inFrame=vec4<f32>(u.crowdTint*(0.05+0.2*rim)*shape,shape*0.75);
  return mix(inMask,inFrame,u.crowdPass);
}
