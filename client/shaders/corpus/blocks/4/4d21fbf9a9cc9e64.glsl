#define pbr_inline
albedoOpacityOutParams albedoOpacityBlock(
in vec4 vAlbedoColor
,in float baseWeight
)
{albedoOpacityOutParams outParams;
vec3 surfaceAlbedo=vAlbedoColor.rgb;
float alpha=vAlbedoColor.a;
#define CUSTOM_FRAGMENT_UPDATE_ALBEDO
surfaceAlbedo*=baseWeight;
outParams.surfaceAlbedo=surfaceAlbedo;
outParams.alpha=alpha;
return outParams;
}