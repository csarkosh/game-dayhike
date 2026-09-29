#version 450
#define SHADER_NAME fragment:halationExtract
layout(set = 1, binding = 3) uniform LeftOver {
        vec2 scale;
    float exposure;
};