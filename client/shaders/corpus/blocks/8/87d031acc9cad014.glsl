layout(location = 3) in vec2 wing;
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
vec3 positionUpdated=position;
vec3 normalUpdated=normal;
vec4 colorUpdated=color;
#define CUSTOM_VERTEX_UPDATE_POSITION
#define CUSTOM_VERTEX_UPDATE_NORMAL
mat4 finalWorld=world;
vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);
vPositionW=vec3(worldPos);
mat3 normalWorld=mat3(finalWorld);
vNormalW=normalize(normalWorld*normalUpdated);
vec3 viewDirectionW=normalize(vEyePosition.xyz-vPositionW);
float NdotV=max(dot(vNormalW,viewDirectionW),0.0);
vec3 roughNormal=mix(vNormalW,viewDirectionW,(0.5*(1.0-NdotV))*baseDiffuseRoughness);
vec3 reflectionVector=vec3(reflectionMatrix*vec4(roughNormal,0)).xyz;
vEnvironmentIrradiance=computeEnvironmentIrradiance(reflectionVector);
#define CUSTOM_VERTEX_UPDATE_WORLDPOS
gl_Position=viewProjection*worldPos;
vec2 uvUpdated=vec2(0.,0.);
vec2 uv2Updated=vec2(0.,0.);
vFogDistance=(view*worldPos).xyz;
vColor=vec4(1.0);
vColor.rgb*=colorUpdated.rgb;
#define CUSTOM_VERTEX_MAIN_END
gl_Position.y *= yFactor_;
}