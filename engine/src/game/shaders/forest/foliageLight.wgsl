{
  if(u32(lights.lights[lightIndex].vLightData.w)==1u){
    let fNdotL=dot(N,pl.L);
    let fUnit=pl.color/3.14159265;
    let fWrapped=clamp((fNdotL+1.0)/(1.0+1.0),0.0,1.0);
    let fBack=pow(clamp(-dot(V,pl.L),0.0,1.0),4.0);
    let fThick=1.0-0.7*input.vFoliageH;
    let fSun=1.0-material.foliageCanopySun*(1.0-input.vFoliage.a);
    directDiffuse+=surfaceAlbedo*(fUnit*(fWrapped+0.6*fBack*fThick)*fSun-fUnit*max(fNdotL,0.0))*pl.atten*material.directIntensity*sf;
  }
}
