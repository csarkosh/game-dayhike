
${data}
${varyings}
const MIDGE_TAU:f32=6.28318531;
const MIDGE_RATE_0:f32=0.7;
const MIDGE_RATE_1:f32=1.3;
const MIDGE_RATE_2:f32=2.1;
const MIDGE_AMP_0:f32=0.55;
const MIDGE_AMP_1:f32=0.3;
const MIDGE_AMP_2:f32=0.15;
const MIDGE_BALL_FLAT:f32=0.6666666666666666;
const MIDGE_CARD:f32=0.003;
const MIDGE_MIN_PX:f32=2.0;
const MIDGE_ALPHA_FLOOR:f32=0.6;
const MIDGE_FLOOR_NEAR:f32=6.0;
const MIDGE_FLOOR_FAR:f32=15.0;
const MIDGE_FLASH_LOW:f32=9.0;
const MIDGE_FLASH_HIGH:f32=14.0;
const MIDGE_LOBE_POWER:f32=8.0;
const MIDGE_FLASH_POWER:f32=24.0;
const MIDGE_FLASH_GAIN:f32=0.5;
const MIDGE_SKY_GLINT:f32=0.6;
const MIDGE_SKY_LOBE_POWER:f32=2.0;
fn midgeHash(i:f32,s:f32)->f32{
  var p=fract(vec3<f32>(i,s,i+s)*0.1031);
  p+=dot(p,p.yzx+33.33);
  return fract((p.x+p.y)*p.z);
}
fn midgeAxis(slot:f32,seed:f32,axis:f32,t:f32)->f32{
  let base=seed+3.0*axis;
  var s=MIDGE_AMP_0*sin(MIDGE_TAU*MIDGE_RATE_0*(0.85+0.3*midgeHash(slot,base+11.0))*t+MIDGE_TAU*midgeHash(slot,base+41.0));
  s+=MIDGE_AMP_1*sin(MIDGE_TAU*MIDGE_RATE_1*(0.85+0.3*midgeHash(slot,base+12.0))*t+MIDGE_TAU*midgeHash(slot,base+42.0));
  s+=MIDGE_AMP_2*sin(MIDGE_TAU*MIDGE_RATE_2*(0.85+0.3*midgeHash(slot,base+13.0))*t+MIDGE_TAU*midgeHash(slot,base+43.0));
  return s;
}
@vertex fn mainVertex(input:VertexInput)->MidgeOut{
  var out:MidgeOut;
  let midge=input.world0.xy;
  let midgeEye=midgeData.eye.xyz;
  let midgeTime=midgeData.eye.w;
  let midgeSun=midgeData.sun.xyz;
  let midgePixel=midgeData.skyGlow.w;
  let at=3*i32(midge.x+0.5);
  let slot=midge.y;
  let place=midgeData.swarms[at];
  let shape=midgeData.swarms[at+1];
  let turn=midgeData.swarms[at+2];
  let seed=turn.z;
  let t=midgeTime;
  let across=place.w*vec2<f32>(midgeAxis(slot,seed,0.0,t),midgeAxis(slot,seed,2.0,t));
  let up=mix(place.w*MIDGE_BALL_FLAT,shape.x,shape.w)*midgeAxis(slot,seed,1.0,t)*(1.0-turn.y);
  let c=cos(turn.x);
  let n=sin(turn.x);
  let centre=place.xyz+vec3<f32>(across.x*c-across.y*n,up,across.x*n+across.y*c);
  let toEye=midgeEye-centre;
  let far=length(toEye);
  let view=toEye/max(far,1.0e-4);
  let size=max(MIDGE_CARD,MIDGE_MIN_PX*midgePixel*far);
  let alive=(1.0-step(shape.y,slot))*(1.0-step(shape.z,0.0));
  var side=cross(vec3<f32>(0.0,1.0,0.0),view);
  side=normalize(mix(vec3<f32>(1.0,0.0,0.0),side,step(1.0e-8,dot(side,side))));
  let rise=cross(view,side);
  let corner=centre+(side*input.position.x+rise*input.position.y)*size*alive;
  out.position=scene.viewProjection*vec4<f32>(corner,1.0);
  out.vCorner=2.0*input.position.xy;
  let nearFloor=MIDGE_ALPHA_FLOOR*clamp((MIDGE_FLOOR_FAR-far)/(MIDGE_FLOOR_FAR-MIDGE_FLOOR_NEAR),0.0,1.0);
  out.vAlpha=max(MIDGE_CARD/size,nearFloor)*shape.z*alive;
  let lobe=pow(max(dot(-view,midgeSun),0.0),MIDGE_LOBE_POWER);
  let rate=mix(MIDGE_FLASH_LOW,MIDGE_FLASH_HIGH,midgeHash(slot,seed+73.0));
  let flash=pow(max(sin(MIDGE_TAU*rate*t+MIDGE_TAU*midgeHash(slot,seed+71.0)),0.0),MIDGE_FLASH_POWER);
  out.vSunGlint=lobe+MIDGE_FLASH_GAIN*flash;
  let sunLevel=vec3<f32>(midgeSun.x,0.0,midgeSun.z);
  let sunFlat=normalize(mix(vec3<f32>(1.0,0.0,0.0),sunLevel,step(1.0e-8,dot(sunLevel,sunLevel))));
  out.vSkyGlint=MIDGE_SKY_GLINT*pow(max(dot(-view,sunFlat),0.0),MIDGE_SKY_LOBE_POWER);
  return out;
}
