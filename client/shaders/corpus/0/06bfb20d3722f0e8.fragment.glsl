#version 450
#define INSTANCES
#define THIN_INSTANCES
#define NUM_BONE_INFLUENCERS 0
#define NUM_MORPH_INFLUENCERS 0
#define SHADER_NAME fragment:midge
layout(set = 1, binding = 1) uniform LeftOver {
        mat4 viewProjection;
    vec3 midgeEye;
    float midgeTime;
    vec3 midgeSun;
    float midgePixel;
    vec4 midgeSwarms[96];
    vec3 midgeSunLight;
    float midgeNight;
    float midgeSkyLuma;
};

precision highp float;
// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};

// The midges' fragment stage, built by midgeSwarms.ts: a soft disc on the
// card, no texture. Its light is the vertex stage's glint (the forward
// scatter toward the sun and the wing's flash) times the sun's colour and
// strength, gone at night, added to what lies behind. Its coverage darkens
// what lies behind by the sky's brightness, so a swarm against a bright sky
// reads as dark specks. The output is premultiplied: the colour carries its
// own alpha, and the alpha says how much of the background the speck hides.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.



layout(location = 0)  in vec2 vCorner;
layout(location = 1)  in float vAlpha;
layout(location = 2)  in float vLight;
const float MIDGE_DARK = 0.6;
layout(location = 0) out vec4 glFragColor;
void main(void) {
float a = vAlpha * clamp(1.0 - dot(vCorner, vCorner), 0.0, 1.0);
vec3 glint = midgeSunLight * (1.0 - midgeNight) * vLight;
float speck = MIDGE_DARK * clamp(midgeSkyLuma, 0.0, 1.0);
glFragColor = vec4(glint * a, speck * a);
}
