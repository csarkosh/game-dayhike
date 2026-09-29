// Foliage fragment definitions, spliced at CUSTOM_FRAGMENT_DEFINITIONS: the
// varyings the vertex block wrote. No sampler, no function.
//
// COMMENT RULES as in foliage.vertex.fx.
layout(location = 8)  in vec4 vFoliage;
layout(location = 9)  in float vFoliageH;
layout(location = 10)  in float vFoliageClump;
layout(location = 11)  in float vFoliageDist;
#define CUSTOM_FRAGMENT_DEFINITIONS
struct albedoOpacityOutParams
{vec3 surfaceAlbedo;
float alpha;
};