#define SHADER_NAME fragment:default
layout(set = 1, binding = 8) uniform LeftOver {
        mat4 lightMatrix1[2];
    float viewFrustumZ1[2];
    float frustumLengths1[2];
    float cascadeBlendFactor1;
    vec4 vFogInfos;
    vec3 vFogColor;
};