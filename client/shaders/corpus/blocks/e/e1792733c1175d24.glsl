vec3 environmentIrradiance=vec3(0.,0.,0.);
vec3 irradianceVector=vec3(reflectionMatrix*vec4(normalW,0)).xyz;
vec3 irradianceView=vec3(reflectionMatrix*vec4(viewDirectionW,0)).xyz;
float NdotV=max(dot(normalW,viewDirectionW),0.0);
irradianceVector=mix(irradianceVector,irradianceView,(0.5*(1.0-NdotV))*diffuseRoughness);
irradianceVector.y*=-1.0;
irradianceView.y*=-1.0;
environmentIrradiance=computeEnvironmentIrradiance(irradianceVector);
environmentIrradiance*=vReflectionColor.rgb*vReflectionInfos.x;
outParams.environmentRadiance=vec4(mix(environmentRadiance.rgb,environmentIrradiance,alphaG),environmentRadiance.a);
outParams.environmentIrradiance=environmentIrradiance;
outParams.reflectionCoords=reflectionCoords;
reflectionBlock_0 = outParams;
}