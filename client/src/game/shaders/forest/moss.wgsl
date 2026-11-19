{${mask}
  let mossColour=textureSample(mossSampler,mossSamplerSampler,input.uv*${mossTile}).rgb;
  let mossLuma=dot(mossColour,${mossLuma});
  let mossW=smoothstep(${mossEdge0},${mossEdge1},mossBand*mossSide*mossTree*(0.5+mossLuma));
  surfaceAlbedo=mix(surfaceAlbedo,mossColour*${mossTint},mossW);
  roughness=mix(roughness,${mossRoughness},mossW);
  ${contact}
}
