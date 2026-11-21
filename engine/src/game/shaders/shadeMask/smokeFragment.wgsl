{
  let shadeSmoke=vec4<f32>(input.vShadeLook.w,${frameBlock}.${smokeTimeName},input.vShadeFeet.x,input.vShadeFeet.y);
  let vPositionW=input.worldPos;
  let normalW=normalize(input.worldNormal);
  let viewDirectionW=normalize(scene.vEyePosition.xyz-vPositionW);
  var shadeColour=pow(clamp(vec3<f32>(input.vShadeLook.x,0.0,input.vShadeLook.y),vec3<f32>(0.0),vec3<f32>(1.0)),vec3<f32>(2.2));
  ${colourCurve}
  var shadeAlpha=input.vShadeLook.z;
  let shadeSmokeUp=clamp((vPositionW.y-shadeSmoke.z)/max(shadeSmoke.w,0.01),0.0,1.0);
  let shadeSmokeN=shadeSmokeFbm(shadeSmokeAt(vPositionW,shadeSmoke.y));
  let shadeSmokeCut=0.75*shadeSmokeN+0.25*shadeSmokeUp;
  let shadeSmokeIn=mix(-SHADE_SMOKE_SOFT,1.0+SHADE_SMOKE_SOFT,shadeSmoke.x);
  var shadeSmokeKeep=smoothstep(shadeSmokeCut-SHADE_SMOKE_SOFT,shadeSmokeCut+SHADE_SMOKE_SOFT,shadeSmokeIn);
  let shadeSmokeRim=1.0-abs(dot(normalW,viewDirectionW));
  let shadeSmokeFray=shadeSmokeFbm(shadeSmokeAt(vPositionW,shadeSmoke.y*1.7)*2.0+vec3<f32>(shadeSmoke.y*0.23,0.0,shadeSmoke.y*0.17));
  shadeSmokeKeep*=1.0-${shadeSmokeFray}*smoothstep(0.35,0.9,shadeSmokeRim+(shadeSmokeFray-0.5)*0.9);
  shadeSmokeKeep*=smoothstep(0.0,SHADE_SMOKE_FEET,shadeSmokeUp);
  shadeAlpha*=shadeSmokeKeep;
  return vec4<f32>(shadeColour,shadeAlpha);
}
