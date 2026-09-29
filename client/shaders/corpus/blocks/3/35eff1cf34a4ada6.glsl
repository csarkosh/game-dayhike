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