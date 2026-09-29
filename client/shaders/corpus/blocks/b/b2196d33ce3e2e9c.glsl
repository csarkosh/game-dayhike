preLightingInfo computeDirectionalPreLightingInfo(vec4 lightData,vec3 V,vec3 N) {preLightingInfo result;
result.lightDistance=length(-lightData.xyz);
result.L=normalize(-lightData.xyz);
result.H=normalize(V+result.L);
result.VdotH=saturate(dot(V,result.H));
result.NdotLUnclamped=dot(N,result.L);
result.NdotL=saturateEps(result.NdotLUnclamped);
result.LdotV=dot(result.L,V);
result.roughness=0.;
result.diffuseRoughness=0.;
result.surfaceAlbedo=vec3(0.);
return result;
}