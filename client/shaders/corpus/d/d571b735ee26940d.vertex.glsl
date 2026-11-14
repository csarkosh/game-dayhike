#version 450
#define NUM_BONE_INFLUENCERS 0
#define NUM_MORPH_INFLUENCERS 0
#define FOG
#define SHADER_NAME vertex:wayLight
layout(set = 1, binding = 3) uniform LeftOver {
        mat4 viewProjection;
    vec3 wayTint;
    vec3 wayEye;
    float wayGain;
    float wayStrata;
    vec4 wayMist;
    vec4 wayGround;
    vec4 wayPath;
    vec4 wayMove;
    vec4 wayDrift;
};

precision highp float;
// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};
// The way down's mist, built by wayLight.ts: the channel of pale ground mist
// the chase shows a player, drawn as sheets over the ground, veils along the
// way and fins across it. One mesh a stretch of way, in world space already.
// Each vertex carries, as wayLightGeometry.ts sets them: its metres from the
// way's line, its metres over the ground, its kind (0 a sheet, 1 a veil, 2 a
// fin) and the metres the mist stands to where it is. The fragment stage
// does the rest, since the mist is shaped by where each fragment is in the
// world.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
layout(location = 0) in vec3 position;
layout(location = 1) in vec4 wayLight;

layout(location = 0)  out vec3 vPlace;
layout(location = 1)  out vec4 vWay;
void main(void) {
vPlace = position;
vWay = wayLight;
gl_Position = viewProjection * vec4(position, 1.0);
gl_Position.y *= yFactor_;
}