// Water plugin, vertex definitions: the ring's per-vertex bed depth (metres
// of water under the vertex, from the terrain height the ring sampled), which
// the fragment stage falls back to outside the bed height texture's square,
// and the vertex's view depth, which the high tier compares with the depth of
// the opaque pass behind it.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
attribute float bedDepth;
varying float vBedDepth;
varying float vWaterViewDepth;
