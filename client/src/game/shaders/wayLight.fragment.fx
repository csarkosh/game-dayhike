// The way down's light, built by wayLight.ts: the vertex stage's amount of
// the one cold colour, added to what lies behind. The blend is additive on
// the alpha, so the colour goes out whole and the alpha is how much of it
// the frame takes.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.

uniform vec3 wayTint;

varying float vAmount;

void main(void) {
  gl_FragColor = vec4(wayTint, vAmount);
}
