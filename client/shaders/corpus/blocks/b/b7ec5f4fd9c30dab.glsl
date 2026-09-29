#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
vec3 positionUpdated=position;
vec3 normalUpdated=normal;
vec2 uvUpdated=uv;
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
vec2 uv2Updated=vec2(0.,0.);
if (vBumpInfos.x==0.)
{vBumpUV=vec2(bumpMatrix*vec4(uvUpdated,1.0,0.0));
}