layout(location = 8)  in vec4 vPositionFromLight1[SHADOWCSMNUM_CASCADES1];
layout(location = 10)  in float vDepthMetric1[SHADOWCSMNUM_CASCADES1];
layout(location = 12)  in vec4 vPositionFromCamera1;
layout(set = 1, binding = 7) uniform samplerShadow shadowTexture1Sampler;
                        layout(set = 1, binding = 6) uniform texture2DArray shadowTexture1Texture;
                        #define shadowTexture1 sampler2DArrayShadow(shadowTexture1Texture, shadowTexture1Sampler)
int index1=-1;
float diff1=0.;
layout(set = 1, binding = 5) uniform Light2
{vec4 vLightData;
vec4 vLightDiffuse;
vec4 vLightSpecular;
vec3 vLightGround;
vec4 shadowsInfo;
vec2 depthValues;
} light2;