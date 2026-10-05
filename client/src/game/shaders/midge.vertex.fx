// The midges' vertex stage, built by midgeSwarms.ts: one card a midge, every
// swarm in one draw. Each instance carries its swarm's row in the table and
// its slot in the swarm. The row holds the swarm's centre (after the wind's
// shift and surge), its size, its shape, how many of its midges show and its
// presence. A midge's place is its swarm's centre plus three sinusoids an
// axis at the midge's own rates and phases, which midgeMotion.ts computes the
// same way (midgeHash, midgeOffset), and a lockstep test holds the constants
// below to its own.
//
// A midge whose slot is at or above its row's count, or whose row has no
// presence, collapses to a point and draws nothing: chosen by step, never by
// a branch, so every midge keeps its slot (and its hash) as counts change.
// The card faces the eye, 3 mm across in the world but never under 2
// pixels, its alpha scaled down by how much it was enlarged but never below
// a floor, so a far midge reads as a dot.
//
// Two glints, each a share handed to the fragment stage, which lights them
// apart: the sun's (a narrow lobe toward the sun and the wing's flash) and
// the sky's (a broad lobe toward the sun's azimuth, level, where the horizon
// still glows after the sun has set).
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.

attribute vec3 position;
attribute vec2 midge;
uniform mat4 viewProjection;
uniform vec3 midgeEye;
uniform float midgeTime;
uniform vec3 midgeSun;
uniform float midgePixel;
uniform vec4 midgeSwarms[96];

varying vec2 vCorner;
varying float vAlpha;
varying float vSunGlint;
varying float vSkyGlint;

const float MIDGE_TAU = 6.28318531;
const float MIDGE_RATE_0 = 0.7;
const float MIDGE_RATE_1 = 1.3;
const float MIDGE_RATE_2 = 2.1;
const float MIDGE_AMP_0 = 0.55;
const float MIDGE_AMP_1 = 0.3;
const float MIDGE_AMP_2 = 0.15;
const float MIDGE_BALL_FLAT = 0.6666666666666666;
const float MIDGE_CARD = 0.003;
const float MIDGE_MIN_PX = 2.0;
const float MIDGE_ALPHA_FLOOR = 0.6;
const float MIDGE_FLASH_LOW = 9.0;
const float MIDGE_FLASH_HIGH = 14.0;
const float MIDGE_LOBE_POWER = 8.0;
const float MIDGE_FLASH_POWER = 24.0;
const float MIDGE_FLASH_GAIN = 0.5;
const float MIDGE_SKY_GLINT = 0.6;
const float MIDGE_SKY_LOBE_POWER = 2.0;

// Hoskins' hash without sine, of a slot and a seed: 0 to 1.
float midgeHash(float i, float s) {
  vec3 p = fract(vec3(i, s, i + s) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

// One axis of a midge's path: three sinusoids, each at its base rate times
// 0.85 to 1.15 and at a phase of its own, weighted to sum to at most 1.
float midgeAxis(float slot, float seed, float axis, float t) {
  float base = seed + 3.0 * axis;
  float s = MIDGE_AMP_0 * sin(MIDGE_TAU * MIDGE_RATE_0 * (0.85 + 0.3 * midgeHash(slot, base + 11.0)) * t + MIDGE_TAU * midgeHash(slot, base + 41.0));
  s += MIDGE_AMP_1 * sin(MIDGE_TAU * MIDGE_RATE_1 * (0.85 + 0.3 * midgeHash(slot, base + 12.0)) * t + MIDGE_TAU * midgeHash(slot, base + 42.0));
  s += MIDGE_AMP_2 * sin(MIDGE_TAU * MIDGE_RATE_2 * (0.85 + 0.3 * midgeHash(slot, base + 13.0)) * t + MIDGE_TAU * midgeHash(slot, base + 43.0));
  return s;
}

void main(void) {
  int at = 3 * int(midge.x + 0.5);
  float slot = midge.y;
  vec4 place = midgeSwarms[at];
  vec4 shape = midgeSwarms[at + 1];
  vec4 turn = midgeSwarms[at + 2];
  float seed = turn.z;
  float t = midgeTime;
  vec2 across = place.w * vec2(midgeAxis(slot, seed, 0.0, t), midgeAxis(slot, seed, 2.0, t));
  float up = mix(place.w * MIDGE_BALL_FLAT, shape.x, shape.w) * midgeAxis(slot, seed, 1.0, t) * (1.0 - turn.y);
  float c = cos(turn.x);
  float n = sin(turn.x);
  vec3 centre = place.xyz + vec3(across.x * c - across.y * n, up, across.x * n + across.y * c);
  vec3 toEye = midgeEye - centre;
  float far = length(toEye);
  vec3 view = toEye / max(far, 1.0e-4);
  float size = max(MIDGE_CARD, MIDGE_MIN_PX * midgePixel * far);
  float alive = (1.0 - step(shape.y, slot)) * (1.0 - step(shape.z, 0.0));
  vec3 side = cross(vec3(0.0, 1.0, 0.0), view);
  side = normalize(mix(vec3(1.0, 0.0, 0.0), side, step(1.0e-8, dot(side, side))));
  vec3 rise = cross(view, side);
  vec3 corner = centre + (side * position.x + rise * position.y) * size * alive;
  gl_Position = viewProjection * vec4(corner, 1.0);
  vCorner = 2.0 * position.xy;
  vAlpha = max(MIDGE_CARD / size, MIDGE_ALPHA_FLOOR) * shape.z * alive;
  float lobe = pow(max(dot(-view, midgeSun), 0.0), MIDGE_LOBE_POWER);
  float rate = mix(MIDGE_FLASH_LOW, MIDGE_FLASH_HIGH, midgeHash(slot, seed + 73.0));
  float flash = pow(max(sin(MIDGE_TAU * rate * t + MIDGE_TAU * midgeHash(slot, seed + 71.0)), 0.0), MIDGE_FLASH_POWER);
  vSunGlint = lobe + MIDGE_FLASH_GAIN * flash;
  vec3 sunLevel = vec3(midgeSun.x, 0.0, midgeSun.z);
  vec3 sunFlat = normalize(mix(vec3(1.0, 0.0, 0.0), sunLevel, step(1.0e-8, dot(sunLevel, sunLevel))));
  vSkyGlint = MIDGE_SKY_GLINT * pow(max(dot(-view, sunFlat), 0.0), MIDGE_SKY_LOBE_POWER);
}
