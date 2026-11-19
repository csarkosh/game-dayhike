
${varyings}
const MOTE_BOX:vec3<f32>=vec3<f32>(${moteBox0},${moteBox1},${moteBox2});
fn moteHash(n:u32)->u32{
  var h=n*747796405u+2891336453u;
  h=((h>>((h>>28u)+4u))^h)*277803737u;
  return (h>>22u)^h;
}
fn moteRandom(slot:u32,life:u32,salt:u32)->f32{
  return f32(moteHash(slot^moteHash(life*0x9e3779b9u+salt))>>8u)/16777216.0;
}
@vertex fn mainVertex(input:VertexInput)->MoteOut{
  var out:MoteOut;
  let u=shaderUniforms;
  let slot=u32(input.world0.x);
  let frost=input.world0.y>0.5;
  let span=select(u.motePollenSpan,u.moteFrostSpan,frost);
  let drift=select(u.motePollenDrift,u.moteFrostDrift,frost);
  let life=sqrt(span.z*span.z+(span.w*span.w-span.z*span.z)*moteRandom(slot,0u,${moteSaltLife}u));
  let t=u.moteClock+moteRandom(slot,0u,${moteSaltPhase}u)*life;
  let lives=floor(t/life);
  let age=t-lives*life;
  let n=u32(lives)+1u;
  let born=vec3<f32>(moteRandom(slot,n,${moteSaltX}u),moteRandom(slot,n,${moteSaltY}u),moteRandom(slot,n,${moteSaltZ}u));
  let carried=vec3<f32>(u.moteTravel.x,0.0,u.moteTravel.y);
  let eye=scene.vEyePosition.xyz;
  let jitter=vec3<f32>(moteRandom(slot,n,${moteSaltDriftX}u),moteRandom(slot,n,${moteSaltDriftY}u),moteRandom(slot,n,${moteSaltDriftZ}u))*2.0-1.0;
  let velocity=vec3<f32>(drift.y*jitter.x,drift.x+0.5*drift.y*jitter.y,drift.y*jitter.z);
  let anchored=(born-0.5)*MOTE_BOX+carried-eye;
  let place=eye+(fract(anchored/MOTE_BOX+0.5)-0.5)*MOTE_BOX+velocity*age;
  let size=span.x+(span.y-span.x)*moteRandom(slot,n,${moteSaltSize}u);
  let cornerPos=input.position.xy*size;
  let viewPos=(scene.view*vec4<f32>(place,1.0)).xyz+vec3<f32>(cornerPos,0.0);
  out.position=select(vec4<f32>(2.0,2.0,2.0,1.0),${frameBlock}.${frameProjectionName}*vec4<f32>(viewPos,1.0),input.world0.z<drift.z);
  out.uv=input.uv;
  out.colour=vec4<f32>(u.moteColour.rgb,u.moteColour.a*(1.0-age/life));
  return out;
}
