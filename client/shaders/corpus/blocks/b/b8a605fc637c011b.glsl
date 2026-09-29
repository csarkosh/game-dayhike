layout(location = 8) in vec2 groundGrad;
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
vec3 positionUpdated=position;
vec3 normalUpdated=normal;
vec4 tangentUpdated=tangent;
vec2 uvUpdated=uv;
#define CUSTOM_VERTEX_UPDATE_POSITION
#define CUSTOM_VERTEX_UPDATE_NORMAL
mat4 finalWorld=mat4(world0,world1,world2,world3);
finalWorld=world*finalWorld;
vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);
vPositionW=vec3(worldPos);
mat3 normalWorld=mat3(finalWorld);
vNormalW=normalUpdated/vec3(dot(normalWorld[0],normalWorld[0]),dot(normalWorld[1],normalWorld[1]),dot(normalWorld[2],normalWorld[2]));
vNormalW=normalize(normalWorld*vNormalW);
vec2 gcOff = worldPos.xz - finalWorld[3].xz;
float gcW = 1.0 - smoothstep(0.0, gcRamp, positionUpdated.y);
worldPos.y += gcW * min(0.0, gcOvershoot * dot(gcOff, groundGrad));
#define CUSTOM_VERTEX_UPDATE_WORLDPOS
gl_Position=viewProjection*worldPos;
vec2 uv2Updated=vec2(0.,0.);
if (vAlbedoInfos.x==0.)
{vAlbedoUV=vec2(albedoMatrix*vec4(uvUpdated,1.0,0.0));
}