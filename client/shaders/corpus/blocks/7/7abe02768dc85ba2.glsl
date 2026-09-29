// Foliage fragment definitions, spliced at CUSTOM_FRAGMENT_DEFINITIONS: the
// varyings the vertex block wrote. No sampler, no function.
//
// COMMENT RULES as in foliage.vertex.fx.
layout(location = 7)  in vec4 vFoliage;
layout(location = 8)  in float vFoliageH;
layout(location = 9)  in float vFoliageClump;
layout(location = 10)  in float vFoliageDist;
layout(location = 11)  in vec4 vFadeBands;
layout(location = 12)  in float vFadeDist;
float dfNoise(vec2 p) {
return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
}