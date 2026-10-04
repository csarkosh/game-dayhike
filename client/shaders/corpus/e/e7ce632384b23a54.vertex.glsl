#version 450
#define NUM_BONE_INFLUENCERS 0
#define NUM_MORPH_INFLUENCERS 0
#define SHADER_NAME vertex:skyDome
layout(set = 1, binding = 3) uniform LeftOver {
        mat4 world;
    mat4 viewProjection;
    float skyScale;
    float skyCloud;
    vec3 skyDeckZenith;
    vec3 skyNight;
    vec3 skyMistAir;
    float skyMistWeight;
    vec3 skySunDir;
    vec3 skyDisc;
    float skyCapture;
    float skyExposure;
    float skyToneMap;
    float skyContrast;
};

precision highp float;
// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};
// The sky dome's vertex stage, built by skyDome.ts. The box rides with the
// eye (infiniteDistance), so a corner's own position is its direction from
// the eye: the fragment stage normalises it.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
layout(location = 0) in vec3 position;


layout(location = 0)  out vec3 vSkyDir;
void main(void) {
vSkyDir = position;
gl_Position = viewProjection * world * vec4(position, 1.0);
gl_Position.y *= yFactor_;
}