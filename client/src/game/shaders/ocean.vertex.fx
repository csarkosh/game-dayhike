#ifdef OCEAN
// The sea's waves, vertex definitions, spliced after the water's own at
// CUSTOM_VERTEX_DEFINITIONS. Everything here, comments too, sits under the
// sea's define, so a lake's shader is the text it was.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The ring's stitch to the coarser ring around it (water.ts): the border
// blend, 0 to 1, and the half-edge to the coarser lattice, metres.
attribute float oceanMorph;
attribute vec2 oceanCoarse;
// The tables the swell is read from (oceanTables.ts): RGBA32F, one row a
// profile, a component or the coastline, read texel by texel and blended by
// hand. highp, since they hold metres and radians in the thousands.
uniform highp sampler2D oceanAtlas;
// The wind sea's displacement, a layer a cascade or a frame of the loop.
uniform highp sampler2DArray oceanWindDisp;
// The swash's table (oceanSwash.fx): RGBA32F, a texel a metre of the cove's
// shore, read at its nearest texel.
uniform highp sampler2D oceanSwash;
// The vertex's world xz before the waves move it.
varying vec2 vOceanXZ;
// The swell the vertex stage sums for the displacement, for the fragment
// stage: its normal's x and z, its height and the slope variance its drawn
// waves carry (vOceanSwellA), and its envelope vector in x and y with the
// vector's length in z (vOceanSwellB), the length interpolated on its own.
varying vec4 vOceanSwellA;
varying vec4 vOceanSwellB;
#endif
