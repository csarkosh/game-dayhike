{
  surfaceAlbedo=mix(FOLIAGE_CARD_GREEN,surfaceAlbedo,material.foliageContrast);
  surfaceAlbedo*=mix(material.foliageRootAO,1.0,input.vFoliageH);
  let fRoot=(1.0-input.vFoliageH)*(1.0-input.vFoliageH);
  let fHas=step(1.0/255.0,max(input.vFoliage.r,max(input.vFoliage.g,input.vFoliage.b)));
  let fTintW=material.foliageTint*fRoot*(1.0+0.5*smoothstep(20.0,80.0,input.vFoliageDist))*fHas;
  surfaceAlbedo=mix(surfaceAlbedo,input.vFoliage.rgb,clamp(fTintW,0.0,0.85));
  surfaceAlbedo*=1.0+${clumpLuma}*(input.vFoliageClump-0.5);
  ${match}
  surfaceAlbedo=max(surfaceAlbedo,FOLIAGE_ALBEDO_FLOOR);
  N=normalize(mix(vec3<f32>(0.0,1.0,0.0),N,mix(material.foliageNormalRoot,1.0,input.vFoliageH)));
  N=faceForward(N,-V,N);
}
