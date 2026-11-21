{
  if(terrainFarW>0.0&&u32(lights.lights[lightIndex].vLightData.w)==1u){
    let tK=mix(1.0,min(clamp(dot(terrainFarN,pl.L),0.0,1.0)/max(pl.NdotL,0.0000001),2.0)*mix(0.8,1.0,clamp(dot(V,pl.L),0.0,1.0)),terrainFarW);
    directDiffuse+=surfaceAlbedo*(1.0/PI)*pl.NdotL*pl.color*pl.atten*material.directIntensity*sf*(tK-1.0);
  }
}
