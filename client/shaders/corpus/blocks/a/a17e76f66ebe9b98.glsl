layout(location = 8) in vec4 fadeBands;
layout(location = 12)  out vec4 vFadeBands;
layout(location = 13)  out float vFadeDist;
// Cliff tint vertex definitions, spliced by CliffTintPlugin (cliffTintPlugin.ts)
// at CUSTOM_VERTEX_DEFINITIONS: the per-instance ground colour the cliff shell
// writes (the same foliage attribute the ground cover carries), handed to the
// fragment stage untouched.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.
layout(location = 9) in vec4 foliage;
layout(location = 14)  out vec4 vCliffTint;
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
vFadeBands = fadeBands;
vFadeDist = distance(finalWorld[3].xz, fadeEye.xz);
// Spliced at CUSTOM_VERTEX_UPDATE_WORLDPOS. The default first, overwritten
// only where the attribute actually exists: the fragment stage treats a
// black rgb as no tint data and leaves the albedo alone.
// COMMENT RULES as in cliffTint.vertex.fx.
vCliffTint = vec4(0.0, 0.0, 0.0, 1.0);
vCliffTint = foliage;
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