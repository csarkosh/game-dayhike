// Moss fragment definitions, spliced at CUSTOM_FRAGMENT_DEFINITIONS: the
// varying the vertex stage wrote, the moss colour map's sampler, and the
// constants of the mask and the look. The sampler is declared here and not
// through the plugin's uniform string, which lands only on the path without
// uniform buffers (terrainTexture.ts records why). Every constant mirrors
// mossParams.ts and a lockstep test asserts they agree.
//
// COMMENT RULES as in moss.vertex.fx.
#ifdef MOSS
varying vec2 vMoss;
uniform sampler2D mossSampler;
const vec3 MOSS_SIDE = vec3(-0.5486, 0.2494, 0.798);
const float MOSS_SIDE_EDGE = 0.6;
const vec2 MOSS_BAND = vec2(1.0, 2.5);
const vec2 MOSS_AMOUNT = vec2(0.25, 1.0);
const vec2 MOSS_EDGE = vec2(0.35, 0.65);
const float MOSS_TILE = 3.0;
const vec3 MOSS_TINT = vec3(0.85, 1.0, 0.75);
const float MOSS_ROUGHNESS = 0.95;
const vec3 MOSS_LUMA = vec3(0.2126, 0.7152, 0.0722);
#endif
