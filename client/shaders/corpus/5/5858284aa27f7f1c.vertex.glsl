#version 450
#define NUM_BONE_INFLUENCERS 0
#define NUM_MORPH_INFLUENCERS 0
#define FOG
#define SHADER_NAME vertex:crowdCards
layout(set = 1, binding = 1) uniform LeftOver {
        mat4 view;
    mat4 viewProjection;
    float crowdTime;
    float crowdPass;
    vec3 crowdTint;
};

precision highp float;
// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};
// The crowd's cards, built by crowdCards.ts: a flat figure for each shade of
// the crowd at the middle distance, drawn into the shade mask alone. One
// mesh, a quad a figure. Each vertex is at its figure's feet in the world and
// carries its corner of the card (x: -1 to 1 across, y: 0 to 1 up), the
// figure's height in metres and how much of it is in the mask. The card is
// half as wide as it is tall (crowdCards.ts CROWD_CARD_WIDE) and stands
// upright, turned about the vertical to face the camera.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
layout(location = 0) in vec3 position;
layout(location = 1) in vec4 crowdCard;
layout(location = 2) in vec2 crowdStir;


layout(location = 0)  out vec4 vCard;
layout(location = 1)  out vec2 vStir;
void main(void) {
  // The camera's right in the world, laid flat.
vec2 right = vec2(view[0][0], view[2][0]);
right /= max(length(right), 0.0001);
vec3 at = position;
at.xz += right * (crowdCard.x * crowdCard.z * 0.25);
at.y += crowdCard.y * crowdCard.z;
vCard = crowdCard;
vStir = crowdStir;
gl_Position = viewProjection * vec4(at, 1.0);
gl_Position.y *= yFactor_;
}