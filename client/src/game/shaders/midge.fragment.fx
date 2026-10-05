// The midges' fragment stage, built by midgeSwarms.ts: a soft disc on the
// card, no texture. Its light is the vertex stage's glint (the forward
// scatter toward the sun and the wing's flash) times the sun's colour and
// strength, gone at night, added to what lies behind. Its coverage darkens
// what lies behind by the sky's brightness, so a swarm against a bright sky
// reads as dark specks. The output is premultiplied: the colour carries its
// own alpha, and the alpha says how much of the background the speck hides.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.

uniform vec3 midgeSunLight;
uniform float midgeNight;
uniform float midgeSkyLuma;

varying vec2 vCorner;
varying float vAlpha;
varying float vLight;

const float MIDGE_DARK = 0.6;

void main(void) {
  float a = vAlpha * clamp(1.0 - dot(vCorner, vCorner), 0.0, 1.0);
  vec3 glint = midgeSunLight * (1.0 - midgeNight) * vLight;
  float speck = MIDGE_DARK * clamp(midgeSkyLuma, 0.0, 1.0);
  gl_FragColor = vec4(glint * a, speck * a);
}
