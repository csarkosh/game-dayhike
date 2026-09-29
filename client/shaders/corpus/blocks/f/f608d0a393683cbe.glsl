#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
vec3 positionUpdated=position;
vec3 normalUpdated=normal;
vec4 tangentUpdated=tangent;
vec2 uvUpdated=uv;
#define CUSTOM_VERTEX_UPDATE_POSITION
#define CUSTOM_VERTEX_UPDATE_NORMAL
mat4 finalWorld=world;
vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);
vPositionW=vec3(worldPos);
mat3 normalWorld=mat3(finalWorld);
vNormalW=normalize(normalWorld*normalUpdated);
#define CUSTOM_VERTEX_UPDATE_WORLDPOS
gl_Position=viewProjection*worldPos;
vec2 uv2Updated=vec2(0.,0.);
vMainUV1=uvUpdated;
vec3 tbnNormal=normalize(normalUpdated);
vec3 tbnTangent=normalize(tangentUpdated.xyz);
vec3 tbnBitangent=cross(tbnNormal,tbnTangent)*tangentUpdated.w;
vTBN=mat3(finalWorld)*mat3(tbnTangent,tbnBitangent,tbnNormal);
vFogDistance=(view*worldPos).xyz;
vPositionFromCamera1=view*worldPos;
for (int i=0;
i<SHADOWCSMNUM_CASCADES1;
i++) {vPositionFromLight1[i]=lightMatrix1[i]*worldPos;
vDepthMetric1[i]=(vPositionFromLight1[i].z+light1.depthValues.x)/light1.depthValues.y;
}