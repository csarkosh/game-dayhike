// Deadwood plugin, vertex definitions: the role attribute (0 a standing snag,
// 1 a fallen log, per thin instance), the varying the fragment reads, the
// bark's uniforms where no uniform buffer carries them, and the hash of the
// tree's foot that draws its moss.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
#ifdef DEADWOOD
attribute float deadwoodRole;
varying vec4 vDeadwood;
float deadwoodHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
#endif
