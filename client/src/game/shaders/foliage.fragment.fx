// Foliage fragment definitions, spliced at CUSTOM_FRAGMENT_DEFINITIONS: the
// varyings the vertex block wrote, the ground cover's green, which the
// colour block compresses a card's texture toward, and the floor it holds
// the albedo above (coverAlbedoParams.ts COVER_GREEN and
// FOLIAGE_ALBEDO_FLOOR, pinned by the lockstep test). No sampler, no
// function.
//
// COMMENT RULES as in foliage.vertex.fx.
#ifdef FOLIAGE
varying vec4 vFoliage;
varying float vFoliageH;
varying float vFoliageClump;
varying float vFoliageDist;
const vec3 FOLIAGE_CARD_GREEN = vec3(0.0851, 0.0841, 0.0252);
const vec3 FOLIAGE_ALBEDO_FLOOR = vec3(0.0532, 0.0525, 0.0158);
#endif
