preLightingInfo computePointAndSpotPreLightingInfo(vec4 lightData,vec3 V,vec3 N,vec3 posW) {preLightingInfo result;
result.lightOffset=lightData.xyz-posW;
result.lightDistanceSquared=dot(result.lightOffset,result.lightOffset);
result.lightDistance=sqrt(result.lightDistanceSquared);
result.L=normalize(result.lightOffset);
result.H=normalize(V+result.L);
result.VdotH=saturate(dot(V,result.H));
result.NdotLUnclamped=dot(N,result.L);
result.NdotL=saturateEps(result.NdotLUnclamped);
result.LdotV=0.;
result.roughness=0.;
result.diffuseRoughness=0.;
result.surfaceAlbedo=vec3(0.);
return result;
}