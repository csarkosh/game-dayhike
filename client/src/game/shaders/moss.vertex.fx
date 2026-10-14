// Moss vertex definitions, spliced by MossPlugin (mossPlugin.ts) at
// CUSTOM_VERTEX_DEFINITIONS: the one varying the fragment stage reads, and
// the hash the per-tree draw is taken from.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.
#ifdef MOSS
varying vec2 vMoss;

// A draw in [0, 1) from a tree's foot in world metres: the hash the wet
// plugin's speckle uses (wet.fragment.fx), without sine, which loses
// precision at world coordinates. Two trees a metre apart draw apart.
float mossHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
#endif
