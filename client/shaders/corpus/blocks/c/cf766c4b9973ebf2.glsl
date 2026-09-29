#define CUSTOM_FRAGMENT_DEFINITIONS
layout(location = 0) out vec4 glFragColor;
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
vec3 viewDirectionW=normalize(vEyePosition.xyz-vPositionW);
vec4 baseColor=vec4(1.,1.,1.,1.);
vec3 diffuseColor=vDiffuseColor.rgb;
float alpha=vDiffuseColor.a;
vec3 normalW=normalize(cross(dFdx(vPositionW),(-yFactor_)*dFdy(vPositionW)))*vEyePosition.w;
vec2 uvOffset=vec2(0.0,0.0);
#define CUSTOM_FRAGMENT_UPDATE_DIFFUSE
vec3 baseAmbientColor=vec3(1.,1.,1.);
#define CUSTOM_FRAGMENT_BEFORE_LIGHTS
float glossiness=vSpecularColor.a;
vec3 specularColor=vSpecularColor.rgb;
vec3 diffuseBase=vec3(0.,0.,0.);
lightingInfo info;
float shadow=1.;
float aggShadow=0.;
float numLights=0.;
aggShadow=aggShadow/numLights;
vec4 refractionColor=vec4(0.,0.,0.,1.);
vec4 reflectionColor=vec4(0.,0.,0.,1.);
vec4 opacityMap=TEXRD(opacitySampler,vOpacityUV+uvOffset);
alpha*=opacityMap.a*vOpacityInfos.y;
vec3 emissiveColor=vEmissiveColor;
vec3 finalDiffuse=clamp(diffuseBase*diffuseColor+emissiveColor+vAmbientColor,0.0,1.0)*baseColor.rgb;
vec3 finalSpecular=vec3(0.0);
vec4 color=vec4(finalDiffuse*baseAmbientColor+finalSpecular+reflectionColor.rgb+refractionColor.rgb,alpha);
#define CUSTOM_FRAGMENT_BEFORE_FOG
color.rgb=max(color.rgb,0.);
float fog=CalcFogFactor();
color.rgb=mix(vFogColor,color.rgb,fog);
color.rgb=toLinearSpace(color.rgb);
color.a*=visibility;
#define CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR
glFragColor=color;
#define CUSTOM_FRAGMENT_MAIN_END
}