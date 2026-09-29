// Foliage fragment definitions, spliced at CUSTOM_FRAGMENT_DEFINITIONS: the
// varyings the vertex block wrote. No sampler, no function.
//
// COMMENT RULES as in foliage.vertex.fx.
layout(location = 13)  in vec4 vFoliage;
layout(location = 14)  in float vFoliageH;
layout(location = 15)  in float vFoliageClump;
layout(location = 16)  in float vFoliageDist;
#define CUSTOM_FRAGMENT_DEFINITIONS
struct albedoOpacityOutParams
{vec3 surfaceAlbedo;
float alpha;
};