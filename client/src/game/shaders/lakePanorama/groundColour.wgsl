{
  var pgColour=material.lakeMirrorColour*(1.0-${mirrorCanopyShade}*input.vPanoramaCanopy);
  let pgDepth=length(input.worldPos-scene.vEyePosition.xyz)*${frameBlock}.atmBaseDensity;
  let pgFog=pow(clamp(exp(-pgDepth*pgDepth),0.0,1.0),2.2);
  pgColour=mix(${frameBlock}.atmFarColour,pgColour,pgFog);
  color=pgColour;
  alpha=1.0;
}
