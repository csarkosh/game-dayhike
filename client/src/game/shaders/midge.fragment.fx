// The midges' fragment stage, built by midgeSwarms.ts: a tent on the card,
// (1 - |u|)(1 - |v|) with u and v running -1 to 1 across it, no texture. At
// the card's fewest pixels, two across, the tent's values at the pixel
// centres it covers sum the same wherever the midge lies, so a far midge
// holds steady as it crosses them.
//
// Its light is the vertex stage's two glints, lit apart and added to what
// lies behind: the sun's share (the forward scatter toward the sun and the
// wing's flash) times the sun's colour and strength, gone at night, and the
// sky's share (toward the sun's azimuth) times the horizon's colour toward
// the sun, which glows on after sunset, past the sky's own night factor, and
// fades to the night sky's floor with the twilight. Its coverage darkens
// what lies behind by the sky's brightness, so a swarm against a bright sky
// reads as dark specks. The output is premultiplied: the colour carries its
// own alpha, and the alpha says how much of the background the speck hides.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.

uniform vec3 midgeSunLight;
uniform vec3 midgeSkyGlow;
uniform float midgeNight;
uniform float midgeSkyLuma;

varying vec2 vCorner;
varying float vAlpha;
varying float vSunGlint;
varying float vSkyGlint;

const float MIDGE_DARK = 0.9;

void main(void) {
  vec2 tent = clamp(1.0 - abs(vCorner), 0.0, 1.0);
  float a = vAlpha * tent.x * tent.y;
  float day = 1.0 - midgeNight;
  vec3 sunGlint = midgeSunLight * day * vSunGlint;
  vec3 skyGlint = midgeSkyGlow * vSkyGlint;
  float speck = MIDGE_DARK * clamp(midgeSkyLuma, 0.0, 1.0);
  gl_FragColor = vec4((sunGlint + skyGlint) * a, speck * a);
}
