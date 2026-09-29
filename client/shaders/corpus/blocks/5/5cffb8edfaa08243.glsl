layout(location = 0) out vec4 glFragColor;
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
vec3 viewDirectionW=normalize(vEyePosition.xyz-vPositionW);
vec3 normalW=normalize(vNormalW);
vec3 geometricNormalW=normalW;
geometricNormalW=gl_FrontFacing ? geometricNormalW : -geometricNormalW;
vec2 uvOffset=vec2(0.0,0.0);
float normalScale=1.0;
mat3 TBN=vTBN;
normalW=perturbNormal(TBN,TEXRD(bumpSampler,vBumpUV+uvOffset).xyz,vBumpInfos.y);
normalW=gl_FrontFacing ? normalW : -normalW;
albedoOpacityOutParams albedoOpacityOut;
vec4 albedoTexture=TEXRD(albedoSampler,vAlbedoUV+uvOffset);
albedoOpacityOut=albedoOpacityBlock(
vAlbedoColor
,albedoTexture
,vAlbedoInfos
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
vec4 surfaceMetallicOrReflectivityColorMap=TEXRD(reflectivitySampler,vReflectivityUV+uvOffset);
vec4 baseReflectivity=surfaceMetallicOrReflectivityColorMap;
vec4 metallicReflectanceFactors=vMetallicReflectanceFactors;
reflectivityOut=reflectivityBlock(
vReflectivityColor
,surfaceAlbedo
,metallicReflectanceFactors
,baseDiffuseRoughness
,vReflectivityInfos
,surfaceMetallicOrReflectivityColorMap
);
float microSurface=reflectivityOut.microSurface;
float roughness=reflectivityOut.roughness;
float diffuseRoughness=reflectivityOut.diffuseRoughness;
surfaceAlbedo=reflectivityOut.surfaceAlbedo;
float NdotVUnclamped=dot(normalW,viewDirectionW);
float NdotV=absEps(NdotVUnclamped);
float alphaG=convertRoughnessToAverageSlope(roughness);
vec2 AARoughnessFactors=getAARoughnessFactors(normalW.xyz);
alphaG+=AARoughnessFactors.y;
vec3 environmentBrdf=getBRDFLookup(NdotV,roughness);
float ambientMonochrome=getLuminance(aoOut.ambientOcclusionColor);
float seo=environmentRadianceOcclusion(ambientMonochrome,NdotVUnclamped);
float eho=environmentHorizonOcclusion(-viewDirectionW,normalW,geometricNormalW);
reflectionOutParams reflectionOut;
reflectionOutParams reflectionBlock_0;
{reflectionOutParams outParams;
vec4 environmentRadiance=vec4(0.,0.,0.,0.);
vec3 reflectionCoords=vec3(0.);
createReflectionCoords(
vPositionW,
normalW,
reflectionCoords
);
{
float reflectionLOD=getLodFromAlphaG(vReflectionMicrosurfaceInfos.x,alphaG);
reflectionLOD=reflectionLOD*vReflectionMicrosurfaceInfos.y+vReflectionMicrosurfaceInfos.z;
float requestedReflectionLOD=reflectionLOD;
environmentRadiance=sampleReflectionLod(reflectionSampler,reflectionCoords,reflectionLOD);
environmentRadiance.rgb=toLinearSpace(environmentRadiance.rgb);
environmentRadiance.rgb*=vReflectionInfos.x;
environmentRadiance.rgb*=vReflectionColor.rgb;
};