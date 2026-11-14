#version 450
#define NUM_BONE_INFLUENCERS 0
#define NUM_MORPH_INFLUENCERS 0
#define FOG
#define SHADER_NAME fragment:crowdEyes
layout(set = 1, binding = 1) uniform LeftOver {
        mat4 view;
    mat4 projection;
};

precision highp float;
// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};

// The crowd's eyes, built by crowdEyes.ts: a soft round light, its colour
// times its level (the vertex colour's alpha), added to what lies behind.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
layout(location = 0)  in vec2 vCorner;
layout(location = 1)  in vec4 vColour;
layout(location = 0) out vec4 glFragColor;
void main(void) {
float round = 1.0 - smoothstep(0.25, 1.0, length(vCorner));
glFragColor = vec4(vColour.rgb * vColour.a, round);
}
