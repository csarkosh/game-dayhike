#define SHADER_NAME fragment:pbr
layout(set = 1, binding = 20) uniform LeftOver {
        vec2 boneTextureInfo;
    vec4 vFogInfos;
    vec3 vFogColor;
};