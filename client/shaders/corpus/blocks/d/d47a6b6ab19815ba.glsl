layout(location = 4)  out vec4 vPositionFromLight1[SHADOWCSMNUM_CASCADES1];
layout(location = 6)  out float vDepthMetric1[SHADOWCSMNUM_CASCADES1];
layout(location = 8)  out vec4 vPositionFromCamera1;
layout(set = 1, binding = 7) uniform Light2
{vec4 vLightData;
vec4 vLightDiffuse;
vec4 vLightSpecular;
vec3 vLightGround;
vec4 shadowsInfo;
vec2 depthValues;
} light2;