layout(location = 0)  out vec2 vMainUV1;
layout(location = 1)  out vec3 vPositionW;
layout(location = 2)  out vec3 vFogDistance;
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
vec3 positionUpdated=position;
vec2 uvUpdated=uv;
#define CUSTOM_VERTEX_UPDATE_POSITION
#define CUSTOM_VERTEX_UPDATE_NORMAL
mat4 finalWorld=world;
vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);
#define CUSTOM_VERTEX_UPDATE_WORLDPOS
gl_Position=viewProjection*worldPos;
vPositionW=vec3(worldPos);
vec2 uv2Updated=vec2(0.,0.);
vMainUV1=uvUpdated;
vFogDistance=(view*worldPos).xyz;
#define CUSTOM_VERTEX_MAIN_END
gl_Position.y *= yFactor_;
}