layout(location = 0) out vec4 glFragColor;
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
vec3 viewDirectionW=normalize(vEyePosition.xyz-vPositionW);
vec3 normalW=normalize(vNormalW);
vec3 geometricNormalW=normalW;
vec2 uvOffset=vec2(0.0,0.0);
albedoOpacityOutParams albedoOpacityOut;
albedoOpacityOut=albedoOpacityBlock(
vAlbedoColor
,baseWeight
);
vec3 surfaceAlbedo=albedoOpacityOut.surfaceAlbedo;
float alpha=albedoOpacityOut.alpha;
#define CUSTOM_FRAGMENT_UPDATE_ALPHA
#define CUSTOM_FRAGMENT_BEFORE_LIGHTS
ambientOcclusionOutParams aoOut;
aoOut=ambientOcclusionBlock(
);
vec3 baseColor=surfaceAlbedo;
reflectivityOutParams reflectivityOut;
vec4 metallicReflectanceFactors=vMetallicReflectanceFactors;
reflectivityOut=reflectivityBlock(
vReflectivityColor
,surfaceAlbedo
,metallicReflectanceFactors
,baseDiffuseRoughness
);
float microSurface=reflectivityOut.microSurface;
float roughness=reflectivityOut.roughness;
float diffuseRoughness=reflectivityOut.diffuseRoughness;
surfaceAlbedo=reflectivityOut.surfaceAlbedo;
float NdotVUnclamped=dot(normalW,viewDirectionW);
float NdotV=absEps(NdotVUnclamped);
float alphaG=convertRoughnessToAverageSlope(roughness);
vec2 AARoughnessFactors=getAARoughnessFactors(normalW.xyz);
vec3 environmentBrdf=getBRDFLookup(NdotV,roughness);
float ambientMonochrome=getLuminance(aoOut.ambientOcclusionColor);
float seo=environmentRadianceOcclusion(ambientMonochrome,NdotVUnclamped);
float reflectanceF0=reflectivityOut.reflectanceF0;
vec3 specularEnvironmentR0=reflectivityOut.colorReflectanceF0;
vec3 specularEnvironmentR90=reflectivityOut.colorReflectanceF90;
clearcoatOutParams clearcoatOut;
clearcoatOut.specularEnvironmentR0=specularEnvironmentR0;
vec3 baseSpecularEnvironmentReflectance=getReflectanceFromBRDFLookup(vec3(reflectanceF0),reflectivityOut.reflectanceF90,environmentBrdf);
vec3 colorSpecularEnvironmentReflectance=getReflectanceFromBRDFLookup(clearcoatOut.specularEnvironmentR0,reflectivityOut.colorReflectanceF90,environmentBrdf);
colorSpecularEnvironmentReflectance*=seo;
subSurfaceOutParams subSurfaceOut;
subSurfaceOut.specularEnvironmentReflectance=colorSpecularEnvironmentReflectance;
vec3 diffuseBase=vec3(0.,0.,0.);
vec3 specularBase=vec3(0.,0.,0.);
vec3 coloredFresnel;
preLightingInfo preInfo;
lightingInfo info;
float shadow=1.;
float aggShadow=0.;
float numLights=0.;
vec4 diffuse0=light0.vLightDiffuse;
#define CUSTOM_LIGHT0_COLOR 
preInfo=computeDirectionalPreLightingInfo(light0.vLightData,viewDirectionW,normalW);
preInfo.NdotV=NdotV;
preInfo.attenuation=1.0;
preInfo.roughness=adjustRoughnessFromLightProperties(roughness,light0.vLightSpecular.a,preInfo.lightDistance);
preInfo.diffuseRoughness=diffuseRoughness;
preInfo.surfaceAlbedo=surfaceAlbedo;
info.diffuse=computeDiffuseLighting(preInfo,diffuse0.rgb);
coloredFresnel=fresnelSchlickGGX(preInfo.VdotH,clearcoatOut.specularEnvironmentR0,reflectivityOut.colorReflectanceF90);
info.specular=computeSpecularLighting(preInfo,normalW,clearcoatOut.specularEnvironmentR0,coloredFresnel,AARoughnessFactors.x,diffuse0.rgb);
shadow=1.;
aggShadow+=shadow;
numLights+=1.0;
diffuseBase+=info.diffuse*shadow;
specularBase+=info.specular*shadow;
aggShadow=aggShadow/numLights;
vec3 baseSpecularEnergyConservationFactor=getEnergyConservationFactor(vec3(reflectanceF0),environmentBrdf);
vec3 coloredEnergyConservationFactor=getEnergyConservationFactor(clearcoatOut.specularEnvironmentR0,environmentBrdf);
vec3 finalSpecular=specularBase;
finalSpecular=max(finalSpecular,0.0);
vec3 finalSpecularScaled=finalSpecular*vLightingIntensity.x*vLightingIntensity.w;
finalSpecularScaled*=coloredEnergyConservationFactor;
vec3 finalDiffuse=diffuseBase;
finalDiffuse*=surfaceAlbedo;
finalDiffuse=max(finalDiffuse,0.0);
finalDiffuse*=vLightingIntensity.x;
vec3 finalAmbient=vAmbientColor;
finalAmbient*=surfaceAlbedo.rgb;
vec3 finalEmissive=vEmissiveColor;
finalEmissive*=vLightingIntensity.y;
vec3 ambientOcclusionForDirectDiffuse=aoOut.ambientOcclusionColor;
finalAmbient*=aoOut.ambientOcclusionColor;
finalDiffuse*=ambientOcclusionForDirectDiffuse;
#define CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION
vec4 finalColor=vec4(
finalSpecularScaled +
finalAmbient +
finalDiffuse,
alpha);
finalColor.rgb+=finalEmissive;
#define CUSTOM_FRAGMENT_BEFORE_FOG
finalColor=max(finalColor,0.0);
finalColor=applyImageProcessing(finalColor);
finalColor.a*=visibility;
#define CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR
glFragColor=finalColor;
#define CUSTOM_FRAGMENT_MAIN_END
}