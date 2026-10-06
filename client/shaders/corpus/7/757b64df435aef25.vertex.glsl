#version 450
#define SHADER_NAME vertex:postprocess
layout(set = 1, binding = 7) uniform LeftOver {
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
    vec4 stareShade;
    vec4 chaseTint;
    vec3 chaseLift;
    vec4 shadeShape;
};

precision highp float;
// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};
layout(location = 0) in vec2 position;

layout(location = 0)  out vec2 vUV;
const vec2 madd=vec2(0.5,0.5);
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
vUV=(position*madd+madd)*scale;
gl_Position=vec4(position,0.0,1.0);
#define CUSTOM_VERTEX_MAIN_END
gl_Position.y *= yFactor_;
}