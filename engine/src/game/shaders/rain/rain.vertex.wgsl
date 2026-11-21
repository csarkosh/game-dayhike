
${varyings}
@vertex fn mainVertex(input:VertexInput)->RainOut{
  var out:RainOut;
  let u=shaderUniforms;
  let rainSeed=input.world0;
  let drip=input.world1.x>0.5;
  let rainBoxMin=select(u.rainBoxMin,u.dripBoxMin,drip);
  let rainBoxSize=select(u.rainBoxSize,u.dripBoxSize,drip);
  let rkI=floor(rainSeed.w*3.0+0.5);
  let rkSel=vec4<f32>(vec4<f32>(rkI)==vec4<f32>(0.0,1.0,2.0,3.0));
  let rSpeed=select(dot(u.rainSpeeds,rkSel),${dripSpeed},drip);
  let rWidth=select(dot(u.rainWidths,rkSel),${dripWidth},drip);
  let rClassAlpha=select(dot(u.rainAlphas,rkSel),1.0,drip);
  let rDrift=select(vec3<f32>(u.rainDrift.x,-rSpeed*u.rainFold/rainBoxSize.y,u.rainDrift.y),vec3<f32>(0.0,-rSpeed*u.rainFold/rainBoxSize.y,0.0),drip);
  let rq=fract(rainSeed.xyz+rDrift-rainBoxMin/rainBoxSize);
  let rp=rainBoxMin+rq*rainBoxSize;
  let rAlong=select(normalize(vec3<f32>(u.rainWind.x,-rSpeed,u.rainWind.y)),vec3<f32>(0.0,-1.0,0.0),drip);
  let rToCam=u.rainCam-rp;
  let rDist=max(length(rToCam),0.001);
  let rView=rToCam/rDist;
  let rSide=cross(rAlong,rView);
  let rRight=rSide/max(length(rSide),0.001);
  let rLen=select(clamp(rSpeed*u.rainDt*${rainStretch},${rainLength0},${rainLength1}),${dripLength},drip);
  let positionUpdated=rp+rRight*(input.position.x*rWidth)+rAlong*(input.position.y*rLen);
  let rFade=smoothstep(${rainFadeNear0},${rainFadeNear1},rDist)*(1.0-smoothstep(${rainFadeFar0},${rainFadeFar1},rDist));
  let rSky=1.0-${rainSkyFade}*smoothstep(0.0,${rainSkyRamp},-rView.y);
  let rToLamp=rp-u.rainLampPos;
  let rLampD2=dot(rToLamp,rToLamp);
  let rCos=dot(rToLamp,u.rainLampDir)/sqrt(max(rLampD2,0.0001));
  let rCone=smoothstep(u.rainLamp.y,0.5+0.5*u.rainLamp.y,rCos);
  let rLampT=u.rainLamp.x*rCone/(1.0+rLampD2);${cover}
  out.rainAlpha=min(rFade*rCover*(rSky*rClassAlpha+rLampT),1.0);
  out.rainLamp=min(rLampT,1.0);
  let worldPos=vec4<f32>(positionUpdated,1.0);
  out.position=select(scene.viewProjection*worldPos,vec4<f32>(2.0,2.0,2.0,1.0),drip&&input.world1.y>=u.rainDripShown);
  out.fogDistance=(scene.view*worldPos).xyz;
  out.uv=input.uv;
  return out;
}
