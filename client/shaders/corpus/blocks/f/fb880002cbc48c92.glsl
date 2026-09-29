layout(location = 3)  out vec4 vColor;
layout(location = 4)  out vec3 vFogDistance;
layout(set = 1, binding = 3) uniform Light0
{vec4 vLightData;
vec4 vLightDiffuse;
vec4 vLightSpecular;
vec4 vLightDirection;
vec4 vLightFalloff;
vec4 shadowsInfo;
vec2 depthValues;
} light0;