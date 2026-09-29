vec3 computeDiffuseLighting(preLightingInfo info,vec3 lightColor) {vec3 diffuseTerm=vec3(1.0/PI);
vec3 clampedAlbedo=clamp(info.surfaceAlbedo,vec3(0.1),vec3(1.0));
diffuseTerm=diffuseBRDF_EON(clampedAlbedo,info.diffuseRoughness,info.NdotL,info.NdotV,info.LdotV);
diffuseTerm/=clampedAlbedo;
return diffuseTerm*info.attenuation*info.NdotL*lightColor;
}