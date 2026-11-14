#version 450
#define NUM_BONE_INFLUENCERS 0
#define NUM_MORPH_INFLUENCERS 0
#define FOG
#define SHADER_NAME vertex:crowdEyes
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
// The crowd's eyes, built by crowdEyes.ts: a pair of small lights for every
// figure of the crowd, which is all of one the mist leaves at a distance. One
// mesh, a quad an eye. Each vertex is at its figure's head in the world and
// carries its corner of the quad (x, y: -1 to 1), the eye's half width in
// metres, and how far to the side of the figure's middle this eye sits, so
// the pair is spread across the screen and always faces the camera.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
layout(location = 0) in vec3 position;
layout(location = 1) in vec4 crowdEye;
layout(location = 2) in vec4 crowdColour;


layout(location = 0)  out vec2 vCorner;
layout(location = 1)  out vec4 vColour;
void main(void) {
vec4 at = view * vec4(position, 1.0);
at.x += crowdEye.w + crowdEye.x * crowdEye.z;
at.y += crowdEye.y * crowdEye.z;
vCorner = crowdEye.xy;
vColour = crowdColour;
gl_Position = projection * at;
gl_Position.y *= yFactor_;
}