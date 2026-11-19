
${varyings}
fn splashHash(p:vec2<f32>)->vec2<f32>{
  var p3=fract(vec3<f32>(p.xyx)*vec3<f32>(0.1031,0.1030,0.0973));
  p3+=dot(p3,p3.yzx+33.33);
  return fract((p3.xx+p3.yz)*p3.zy);
}
@vertex fn mainVertex(input:VertexInput)->SplashOut{
  var out:SplashOut;
  let u=shaderUniforms;
  let splashSeed=input.world0;
  let sT=u.splashTime/${splashLife}+splashSeed.x;
  let sCycle=floor(sT)-${splashCycles}*floor(floor(sT)/${splashCycles});
  let sPhase=fract(sT);
  let sH=splashHash(splashSeed.yz+sCycle);
  let sR=${splashRadius}*sqrt(sH.x);
  let sA=6.2831853*sH.y;
  let sXZ=u.splashCam.xz+vec2<f32>(cos(sA),sin(sA))*sR;
  let sMu=(sXZ-u.splashMapCentre)/u.splashMapExtent+0.5;
  let sMap=textureLoad(splashMap,vec2<i32>(clamp(sMu*${rainMapTexels},vec2<f32>(0.0),vec2<f32>(${rainMapLast}))),0);
  let sIn=step(0.0,sMu.x)*step(sMu.x,1.0)*step(0.0,sMu.y)*step(sMu.y,1.0);
  let sp=vec3<f32>(sXZ.x,sMap.r,sXZ.y);
  let sToCam=u.splashCam-sp;
  let sDist=max(length(sToCam),0.001);
  let sView=sToCam/sDist;
  let sSide=cross(vec3<f32>(0.0,1.0,0.0),sView);
  let sRight=sSide/max(length(sSide),0.001);
  let sUp=cross(sView,sRight);
  let sSize=mix(${splashSize0},${splashSize1},splashSeed.w)*(0.5+sPhase)*sIn;
  let positionUpdated=sp+(sRight*input.position.x+sUp*input.position.y)*sSize;
  let sSunT=max(dot(sView,u.splashSun),0.0);
  let sToLamp=sp-u.splashLampPos;
  let sLampD2=dot(sToLamp,sToLamp);
  let sCos=dot(sToLamp,u.splashLampDir)/sqrt(max(sLampD2,0.0001));
  let sCone=smoothstep(u.splashLamp.y,0.5+0.5*u.splashLamp.y,sCos);
  let sLampT=u.splashLamp.x*sCone/(1.0+sLampD2);
  let sBack=min(sSunT+sLampT,1.0);
  out.splashAlpha=(1.0-sPhase)*u.splashRain*(0.5+0.5*sBack)*sIn;
  out.splashPhase=sPhase;
  out.splashUv=input.position.xy+0.5;
  let worldPos=vec4<f32>(positionUpdated,1.0);
  out.position=scene.viewProjection*worldPos;
  out.fogDistance=(scene.view*worldPos).xyz;
  return out;
}
