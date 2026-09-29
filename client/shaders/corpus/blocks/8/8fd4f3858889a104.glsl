#define WORLD_UBO
layout(location = 2)  in vec3 vPositionW;
layout(location = 3)  in vec3 vNormalW;
layout(set = 1, binding = 3) uniform Light0
{vec4 vLightData;
vec4 vLightDiffuse;
vec4 vLightSpecular;
vec4 vLightDirection;
vec4 vLightFalloff;
vec4 shadowsInfo;
vec2 depthValues;
} light0;