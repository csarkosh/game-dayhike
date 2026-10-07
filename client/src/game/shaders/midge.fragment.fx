// The midges' fragment stage, built by midgeSwarms.ts: a tent on the card,
// (1 - |u|)(1 - |v|) with u and v running -1 to 1 across it, no texture. At
// the card's fewest pixels, two across, the tent's values at the pixel
// centres it covers sum the same wherever a midge on the view axis lies, its
// card square to the screen there, so a far midge holds steady as it crosses
// them.
//
// Its light is the vertex stage's two glints, lit apart and added to what
// lies behind: the sun's share (the forward scatter toward the sun and the
// wing's flash) times the sun's colour and strength, gone at night, and the
// sky's share (toward the sun's azimuth) times the horizon's colour toward
// the sun, which glows on after sunset, past the sky's own night factor, and
// fades to the night sky's floor with the twilight. Its coverage darkens
// what lies behind by the sky's brightness, so a swarm against a bright sky
// reads as dark specks. The output is premultiplied: the colour carries its
// own coverage, and the alpha says how much of the background the speck
// hides.
//
// On the material colour path (no post chain) the light a speck adds, its
// glint times its coverage, takes the image's exposure (the stare's dimming
// in it), the Khronos PBR Neutral tone map, the sRGB encode and the contrast,
// in the order Babylon's image processing applies them to every other
// material there, as the post chain takes the frame it lands in on the
// other path. The alpha is never toned, as Babylon's image processing never
// touches alpha. On the post path the light goes out as it is.
//
// The tone map's selections, and the colour path's, are made by step and mix
// on uniforms and computed values, never by a branch, as every choice in
// these stages is.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.

uniform vec3 midgeSunLight;
uniform vec3 midgeSkyGlow;
uniform float midgeNight;
uniform float midgeSkyLuma;
uniform float midgeExposure;
uniform float midgeToneMap;
uniform float midgeContrast;

varying vec2 vCorner;
varying float vAlpha;
varying float vSunGlint;
varying float vSkyGlint;

const float MIDGE_DARK = 0.9;
// Khronos PBR Neutral's published constants: where compression starts, and
// how far a compressed colour desaturates.
const float MIDGE_NEUTRAL_START = 0.76;
const float MIDGE_NEUTRAL_DESATURATION = 0.15;

// Khronos PBR Neutral, as Babylon's image processing defines it, its early
// return for an uncompressed colour and its offset's choice made by step and
// mix. The compression is worked from the peak held at the start or above
// it, so the side not taken stays a number: from the peak itself its divisor
// is 0 at a peak of 0.52, and a mix that takes none of a NaN still takes it.
vec3 midgeNeutral(vec3 color) {
  float x = min(color.r, min(color.g, color.b));
  float offset = mix(x - 6.25 * x * x, 0.04, step(0.08, x));
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  float top = max(peak, MIDGE_NEUTRAL_START);
  float k = 1.0 - MIDGE_NEUTRAL_START;
  float newPeak = 1.0 - k * k / (top + k - MIDGE_NEUTRAL_START);
  float g = 1.0 - 1.0 / (MIDGE_NEUTRAL_DESATURATION * (top - newPeak) + 1.0);
  vec3 compressed = mix(color * (newPeak / top), vec3(newPeak), g);
  return mix(color, compressed, step(MIDGE_NEUTRAL_START, peak));
}

// Babylon's contrast, after the encode, as its image processing applies it,
// its two sides chosen by step.
vec3 midgeContrastOf(vec3 c) {
  vec3 high = c * c * (3.0 - 2.0 * c);
  vec3 low = mix(vec3(0.5), c, midgeContrast);
  vec3 raised = mix(c, high, midgeContrast - 1.0);
  return max(mix(low, raised, step(1.0, midgeContrast)), 0.0);
}

void main(void) {
  vec2 tent = clamp(1.0 - abs(vCorner), 0.0, 1.0);
  float a = vAlpha * tent.x * tent.y;
  float day = 1.0 - midgeNight;
  vec3 sunGlint = midgeSunLight * day * vSunGlint;
  vec3 skyGlint = midgeSkyGlow * vSkyGlint;
  float speck = MIDGE_DARK * clamp(midgeSkyLuma, 0.0, 1.0);
  vec3 light = (sunGlint + skyGlint) * a;
  vec3 toned = midgeNeutral(light * midgeExposure);
  toned = clamp(pow(max(toned, vec3(0.0)), vec3(1.0 / 2.2)), 0.0, 1.0);
  toned = midgeContrastOf(toned);
  gl_FragColor = vec4(mix(light, toned, step(0.5, midgeToneMap)), speck * a);
}
