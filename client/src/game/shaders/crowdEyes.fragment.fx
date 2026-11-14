// The crowd's eyes, built by crowdEyes.ts: a soft round light, its colour
// times its level (the vertex colour's alpha), added to what lies behind.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.

varying vec2 vCorner;
varying vec4 vColour;

void main(void) {
  float round = 1.0 - smoothstep(0.25, 1.0, length(vCorner));
  gl_FragColor = vec4(vColour.rgb * vColour.a, round);
}
