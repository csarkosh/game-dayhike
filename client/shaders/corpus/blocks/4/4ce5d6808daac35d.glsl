layout(location = 8) in vec2 wing;
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
vec3 positionUpdated=position;
vec3 normalUpdated=normal;
vec4 tangentUpdated=tangent;
vec2 uvUpdated=uv;
float wingSide = positionUpdated.x < 0.0 ? -1.0 : 1.0;
float wingAbsX = abs(positionUpdated.x);
float wingSpan = clamp(wingAbsX / wingHalfSpan, 0.0, 1.0);
float wingA = wing.y * sin(wingTime * wingOmega + wing.x) * wingSpan;
float wingC = cos(wingA);
float wingS = sin(wingA);
float wingY0 = positionUpdated.y;
positionUpdated.y = wingY0 * wingC + wingAbsX * wingS;
positionUpdated.x = wingSide * (wingAbsX * wingC - wingY0 * wingS);
#define CUSTOM_VERTEX_UPDATE_POSITION
#define CUSTOM_VERTEX_UPDATE_NORMAL
mat4 finalWorld=mat4(world0,world1,world2,world3);
finalWorld=world*finalWorld;
vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);
vPositionW=vec3(worldPos);
mat3 normalWorld=mat3(finalWorld);
vNormalW=normalUpdated/vec3(dot(normalWorld[0],normalWorld[0]),dot(normalWorld[1],normalWorld[1]),dot(normalWorld[2],normalWorld[2]));
vNormalW=normalize(normalWorld*vNormalW);
#define CUSTOM_VERTEX_UPDATE_WORLDPOS
gl_Position=viewProjection*worldPos;
vec2 uv2Updated=vec2(0.,0.);
vMainUV1=uvUpdated;
vec3 tbnNormal=normalize(normalUpdated);
vec3 tbnTangent=normalize(tangentUpdated.xyz);
vec3 tbnBitangent=cross(tbnNormal,tbnTangent)*tangentUpdated.w;
vTBN=mat3(finalWorld)*mat3(tbnTangent,tbnBitangent,tbnNormal);
vFogDistance=(view*worldPos).xyz;
#define CUSTOM_VERTEX_MAIN_END
gl_Position.y *= yFactor_;
}