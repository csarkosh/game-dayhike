
${varyings}
const SURF_SPRAY_G:f32=${surfSprayG};
const SURF_SPRAY_DRAG:f32=${surfSprayDrag};
const SURF_SPRAY_LIFE_MIN:f32=${surfSprayLifeS0};
const SURF_SPRAY_LIFE_MAX:f32=${surfSprayLifeS1};
const SURF_SPRAY_SIZE:f32=${surfSpraySizeM};
const SURF_SPRAY_STRETCH:f32=${surfSprayStretchM};
const SURF_SPRAY_ELEVATION_MIN:f32=${surfSprayElevation0};
const SURF_SPRAY_ELEVATION_MAX:f32=${surfSprayElevation1};
const SURF_SPRAY_SPEED_MIN:f32=${surfSpraySpeedMin};
@vertex fn mainVertex(input:VertexInput)->SprayOut{
  var out:SprayOut;
  let u=shaderUniforms;
  let spraySeed=input.world0;
  let sprayBurst=input.world1.x;
  var surfSprayBursts=array<vec4<f32>,${burstSlots}>(${slots});
  let slot=2*i32(sprayBurst+0.5);
  let origin=surfSprayBursts[slot];
  let launch=surfSprayBursts[slot+1];
  let life=mix(SURF_SPRAY_LIFE_MIN,SURF_SPRAY_LIFE_MAX,spraySeed.w);
  let alive=step(0.0,origin.w)*(1.0-step(life,origin.w));
  let t=clamp(origin.w,0.0,life);
  let ahead=vec3<f32>(launch.x,0.0,launch.y);
  let across=vec3<f32>(-launch.y,0.0,launch.x);
  let start=origin.xyz+across*(spraySeed.x-0.5)*SURF_SPRAY_STRETCH;
  let elevation=mix(SURF_SPRAY_ELEVATION_MIN,SURF_SPRAY_ELEVATION_MAX,spraySeed.y);
  let speed=launch.z*mix(SURF_SPRAY_SPEED_MIN,1.0,spraySeed.z);
  let v0=(ahead*cos(elevation)+vec3<f32>(0.0,sin(elevation),0.0))*speed;
  let drift=vec3<f32>(u.sprayWind.x,-SURF_SPRAY_G/SURF_SPRAY_DRAG,u.sprayWind.y);
  let p=start+drift*t+(v0-drift)*(1.0-exp(-SURF_SPRAY_DRAG*t))/SURF_SPRAY_DRAG;
  let toEye=u.sprayCam-p;
  let view=toEye/max(length(toEye),0.001);
  let side=cross(vec3<f32>(0.0,1.0,0.0),view);
  let right=side/max(length(side),0.001);
  let up=cross(view,right);
  let lived=t/life;
  let size=SURF_SPRAY_SIZE*(0.5+0.5*lived)*alive;
  let sprayAt=vec4<f32>(p+(right*input.position.x+up*input.position.y)*size,(1.0-lived)*alive);
  let positionUpdated=sprayAt.xyz;
  out.sprayAlpha=sprayAt.w;
  out.sprayUv=input.position.xy+0.5;
  let worldPos=vec4<f32>(positionUpdated,1.0);
  out.position=scene.viewProjection*worldPos;
  out.fogDistance=(scene.view*worldPos).xyz;
  return out;
}
