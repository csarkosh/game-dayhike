vec3 computeSpecularLighting(preLightingInfo info,vec3 N,vec3 reflectance0,vec3 fresnel,float geometricRoughnessFactor,vec3 lightColor) {float NdotH=saturateEps(dot(N,info.H));
float roughness=max(info.roughness,geometricRoughnessFactor);
float alphaG=convertRoughnessToAverageSlope(roughness);
float distribution=normalDistributionFunction_TrowbridgeReitzGGX(NdotH,alphaG);
float smithVisibility=smithVisibility_GGXCorrelated(info.NdotL,info.NdotV,alphaG);
vec3 specTerm=fresnel*distribution*smithVisibility;
return specTerm*info.attenuation*info.NdotL*lightColor;
}