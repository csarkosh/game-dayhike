vec3 environmentIrradiance=vec3(0.,0.,0.);
environmentIrradiance=vEnvironmentIrradiance;
environmentIrradiance*=vReflectionColor.rgb*vReflectionInfos.x;
outParams.environmentRadiance=vec4(mix(environmentRadiance.rgb,environmentIrradiance,alphaG),environmentRadiance.a);
outParams.environmentIrradiance=environmentIrradiance;
outParams.reflectionCoords=reflectionCoords;
reflectionBlock_0 = outParams;
}