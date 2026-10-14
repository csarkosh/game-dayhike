// Foliage fragment definitions, spliced at CUSTOM_FRAGMENT_DEFINITIONS: the
// varyings the vertex block wrote, and the ground cover's green, which the
// colour block compresses a card's texture toward (coverAlbedoParams.ts
// COVER_GREEN, pinned by the lockstep test). No sampler, no function.
//
// COMMENT RULES as in foliage.vertex.fx.
#ifdef FOLIAGE
varying vec4 vFoliage;
varying float vFoliageH;
varying float vFoliageClump;
varying float vFoliageDist;
const vec3 FOLIAGE_CARD_GREEN = vec3(0.1237, 0.2061, 0.0824);
#endif
