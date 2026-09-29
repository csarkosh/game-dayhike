layout(location = 4)  out vec3 vFogDistance;
layout(set = 1, binding = 5) uniform Light0
{vec4 vLightData;
vec4 vLightDiffuse;
vec4 vLightSpecular;
vec4 vLightDirection;
vec4 vLightFalloff;
vec4 shadowsInfo;
vec2 depthValues;
} light0;