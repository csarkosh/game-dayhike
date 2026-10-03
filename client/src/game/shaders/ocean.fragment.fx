#ifdef OCEAN
// The sea's waves, fragment definitions, spliced after the water's own at
// CUSTOM_FRAGMENT_DEFINITIONS. Everything here, comments too, sits under the
// sea's define, so a lake's shader is the text it was. The samplers are
// declared here and not in getUniforms().fragment, as the water's own are.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
uniform highp sampler2D oceanAtlas;
uniform highp sampler2DArray oceanWindDisp;
uniform highp sampler2DArray oceanWindSlope;
// The world xz the surface's waves are evaluated at: where the vertex stood
// before they moved it.
varying vec2 vOceanXZ;
// The swell the vertex stage sums for the displacement, for the fragment
// stage: its normal's x and z, its height and the slope variance its drawn
// waves carry (vOceanSwellA), and its envelope vector in x and y (vOceanSwellB).
varying vec4 vOceanSwellA;
varying vec4 vOceanSwellB;
#endif
