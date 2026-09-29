#define pbr_inline
reflectivityOutParams reflectivityBlock(
in vec4 reflectivityColor
,in vec3 surfaceAlbedo
,in vec4 metallicReflectanceFactors
,in float baseDiffuseRoughness
)
{reflectivityOutParams outParams;
float microSurface=reflectivityColor.a;
vec3 surfaceReflectivityColor=reflectivityColor.rgb;
vec2 metallicRoughness=surfaceReflectivityColor.rg;
float ior=surfaceReflectivityColor.b;
#define CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS
microSurface=1.0-metallicRoughness.g;
vec3 baseColor=surfaceAlbedo;
outParams.metallic=metallicRoughness.r;
outParams.specularWeight=metallicReflectanceFactors.a;
float dielectricF0=reflectivityColor.a*outParams.specularWeight;
surfaceReflectivityColor=metallicReflectanceFactors.rgb;
outParams.surfaceAlbedo=baseColor.rgb*(vec3(1.0)-vec3(dielectricF0)*surfaceReflectivityColor)*(1.0-outParams.metallic);
{vec3 reflectivityColor=mix(dielectricF0*surfaceReflectivityColor,baseColor.rgb,outParams.metallic);
outParams.reflectanceF0=max(reflectivityColor.r,max(reflectivityColor.g,reflectivityColor.b));
}