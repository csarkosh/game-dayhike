#version 450
#define SHADER_NAME fragment:grade
layout(set = 1, binding = 5) uniform LeftOver {
        vec2 scale;
    float exposure;
    mat3 whitePoint;
    mat3 purkinje;
    float purkinjeThreshold;
    float purkinjeStrength;
    vec3 shadowTint;
    vec2 shadowAmount;
    vec3 midtoneTint;
    vec2 midtoneAmount;
    vec3 highlightTint;
    vec2 highlightAmount;
    vec3 lift;
    float saturation;
    float vignetteWeight;
    vec3 vignetteColour;
    float halationStrength;
};