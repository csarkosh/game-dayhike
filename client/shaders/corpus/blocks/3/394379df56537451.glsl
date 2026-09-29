aggShadow+=shadow;
numLights+=1.0;
diffuseBase+=info.diffuse*shadow;
specularBase+=info.specular*shadow;
clearCoatBase+=info.clearCoat.rgb*shadow;
vec4 diffuse2=light2.vLightDiffuse;
#define CUSTOM_LIGHT2_COLOR 
preInfo=computeHemisphericPreLightingInfo(light2.vLightData,viewDirectionW,normalW);
preInfo.NdotV=NdotV;
preInfo.attenuation=1.0;
preInfo.roughness=roughness;
preInfo.diffuseRoughness=diffuseRoughness;
preInfo.surfaceAlbedo=surfaceAlbedo;
info.diffuse=computeHemisphericDiffuseLighting(preInfo,diffuse2.rgb,light2.vLightGround);
coloredFresnel=fresnelSchlickGGX(preInfo.VdotH,clearcoatOut.specularEnvironmentR0,reflectivityOut.colorReflectanceF90);
info.specular=computeSpecularLighting(preInfo,normalW,clearcoatOut.specularEnvironmentR0,coloredFresnel,AARoughnessFactors.x,diffuse2.rgb);
preInfo.roughness=clearcoatOut.clearCoatRoughness;
info.clearCoat=computeClearCoatLighting(preInfo,clearcoatOut.clearCoatNormalW,clearcoatOut.clearCoatAARoughnessFactors.x,clearcoatOut.clearCoatIntensity,diffuse2.rgb);
info.diffuse*=info.clearCoat.w;
info.specular*=info.clearCoat.w;
shadow=1.;
aggShadow+=shadow;
numLights+=1.0;
diffuseBase+=info.diffuse*shadow;
specularBase+=info.specular*shadow;
clearCoatBase+=info.clearCoat.rgb*shadow;
aggShadow=aggShadow/numLights;
vec3 baseSpecularEnergyConservationFactor=getEnergyConservationFactor(vec3(reflectanceF0),environmentBrdf);
vec3 coloredEnergyConservationFactor=getEnergyConservationFactor(clearcoatOut.specularEnvironmentR0,environmentBrdf);
vec3 finalIrradiance=reflectionOut.environmentIrradiance;
finalIrradiance*=clearcoatOut.conservationFactor;
finalIrradiance*=surfaceAlbedo.rgb;
finalIrradiance*=vLightingIntensity.z;
finalIrradiance*=aoOut.ambientOcclusionColor;
vec3 finalSpecular=specularBase;
finalSpecular=max(finalSpecular,0.0);
vec3 finalSpecularScaled=finalSpecular*vLightingIntensity.x*vLightingIntensity.w;
finalSpecularScaled*=coloredEnergyConservationFactor;
vec3 finalRadiance=reflectionOut.environmentRadiance.rgb;
finalRadiance*=colorSpecularEnvironmentReflectance;
vec3 finalRadianceScaled=finalRadiance*vLightingIntensity.z;
finalRadianceScaled*=coloredEnergyConservationFactor;
vec3 finalClearCoat=clearCoatBase;
finalClearCoat=max(finalClearCoat,0.0);
vec3 finalClearCoatScaled=finalClearCoat*vLightingIntensity.x*vLightingIntensity.w;
finalClearCoatScaled*=clearcoatOut.energyConservationFactorClearCoat;
vec3 finalDiffuse=diffuseBase;
finalDiffuse*=surfaceAlbedo;
finalDiffuse=max(finalDiffuse,0.0);
finalDiffuse*=vLightingIntensity.x;
vec3 finalAmbient=vAmbientColor;
finalAmbient*=surfaceAlbedo.rgb;
vec3 finalEmissive=vEmissiveColor;
finalEmissive*=vLightingIntensity.y;
vec3 ambientOcclusionForDirectDiffuse=mix(vec3(1.),aoOut.ambientOcclusionColor,vAmbientInfos.w);
finalAmbient*=aoOut.ambientOcclusionColor;
finalDiffuse*=ambientOcclusionForDirectDiffuse;
#define CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION
vec4 finalColor=vec4(
finalIrradiance +
finalSpecularScaled +
finalClearCoatScaled +
finalRadianceScaled +
clearcoatOut.finalClearCoatRadianceScaled +
finalAmbient +
finalDiffuse,
alpha);
finalColor.rgb+=finalEmissive;
#define CUSTOM_FRAGMENT_BEFORE_FOG
finalColor=max(finalColor,0.0);
float fog=CalcFogFactor();
fog=toLinearSpace(fog);
finalColor.rgb=atmosphereFog(finalColor.rgb,fog);
finalColor.rgb=clamp(finalColor.rgb,0.,30.0);
finalColor.a*=visibility;
#define CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR
glFragColor=finalColor;
#define CUSTOM_FRAGMENT_MAIN_END
}