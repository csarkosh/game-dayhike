#define pbr_inline
albedoOpacityOutParams albedoOpacityBlock(
in vec4 vAlbedoColor
,in vec4 albedoTexture
,in vec2 albedoInfos
,in float baseWeight
)
{albedoOpacityOutParams outParams;
vec3 surfaceAlbedo=vAlbedoColor.rgb;
float alpha=vAlbedoColor.a;
alpha*=albedoTexture.a;
surfaceAlbedo*=albedoTexture.rgb;
surfaceAlbedo*=albedoInfos.y;
#define CUSTOM_FRAGMENT_UPDATE_ALBEDO
surfaceAlbedo*=baseWeight;
outParams.surfaceAlbedo=surfaceAlbedo;
outParams.alpha=alpha;
return outParams;
}