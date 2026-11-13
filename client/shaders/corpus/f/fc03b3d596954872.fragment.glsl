#version 450
#define NUM_BONE_INFLUENCERS 0
#define NUM_MORPH_INFLUENCERS 0
#define FOG
#define SHADER_NAME fragment:wayLight
layout(set = 1, binding = 1) uniform LeftOver {
        mat4 viewProjection;
    vec3 wayEye;
    float wayGain;
    vec4 wayShape;
    vec3 wayTint;
};

precision highp float;
// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};

// The way down's light, built by wayLight.ts: the vertex stage's amount of
// the one cold colour, added to what lies behind. The blend is additive on
// the alpha, so the colour goes out whole and the alpha is how much of it
// the frame takes.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.

layout(location = 0)  in float vAmount;
layout(location = 0) out vec4 glFragColor;
void main(void) {
glFragColor = vec4(wayTint, vAmount);
}
