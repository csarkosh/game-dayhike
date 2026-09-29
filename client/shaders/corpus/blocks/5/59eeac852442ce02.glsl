#define SHADER_NAME fragment:pbr
layout(set = 1, binding = 21) uniform LeftOver {
        vec2 boneTextureInfo;
    mat4 lightMatrix1[2];
    float viewFrustumZ1[2];
    float frustumLengths1[2];
    float cascadeBlendFactor1;
    vec4 vFogInfos;
    vec3 vFogColor;
};