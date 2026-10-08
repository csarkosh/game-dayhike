#version 450
#define VERTEXCOLOR
#define NUM_BONE_INFLUENCERS 0
#define NUM_MORPH_INFLUENCERS 0
#define FOG
#define SHADER_NAME vertex:lakeMirrorTerrain
layout(set = 1, binding = 1) uniform LeftOver {
        mat4 world;
    mat4 viewProjection;
    mat4 view;
    vec3 lakeMirrorColour;
    vec4 vFogInfos;
    vec3 vFogColor;
};

precision highp float;
// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};
// The lake mirror's ground, vertex stage (lakeMirror.ts): the inner terrain
// rings drawn into the mirror's target in place of the terrain's own
// material, which is far too costly for a second pass. The canopy's density
// rides in terrainWeights2.w, as the rain map's height shader reads it.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
layout(location = 0) in vec3 position;
layout(location = 1) in vec4 terrainWeights2;


layout(location = 0)  out float vCanopy;
// The scene's fog, as Babylon's own fog includes reckon it: the distance in
// the view the pass is drawn with, the mirrored camera's.

layout(location = 1)  out vec3 vFogDistance;
void main(void) {
vec4 worldPos = world * vec4(position, 1.0);
vCanopy = terrainWeights2.w;
vFogDistance = (view * worldPos).xyz;
gl_Position = viewProjection * worldPos;
gl_Position.y *= yFactor_;
}