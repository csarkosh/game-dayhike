#version 450
#define VERTEXCOLOR
#define NUM_BONE_INFLUENCERS 0
#define NUM_MORPH_INFLUENCERS 0
#define FOG
#define SHADER_NAME fragment:lakeMirrorTerrain
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

// The lake mirror's ground, fragment stage (lakeMirror.ts): one flat colour,
// the ground's lit base colour the renderer sets each frame the pass runs
// (lakeMirrorColour, linear), darker under the canopy, then fogged as the
// scene's materials are.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The literal below mirrors MIRROR_CANOPY_SHADE in lakeMirror.ts and a
// lockstep test holds them equal.

layout(location = 0)  in float vCanopy;


layout(location = 1)  in vec3 vFogDistance;
// How much darker the ground is under a full canopy.
const float LAKE_MIRROR_CANOPY_SHADE = 0.5;
layout(location = 0) out vec4 glFragColor;
void main(void) {
vec3 colour = lakeMirrorColour * (1.0 - LAKE_MIRROR_CANOPY_SHADE * vCanopy);
  // The scene's fog is Babylon's squared exponential (lighting.ts), its
  // density in vFogInfos.w, its factor taken to linear space before the mix
  // as PBR takes it. That fog alone: not the atmosphere's height fog, which
  // the terrain also takes in the main view.
float fogDepth = length(vFogDistance) * vFogInfos.w;
float fog = pow(clamp(exp(-fogDepth * fogDepth), 0.0, 1.0), 2.2);
colour = mix(vFogColor, colour, fog);
glFragColor = vec4(colour, 1.0);
}
