// The far ground's cover: the constants and functions the terrain's far
// cover reads, spliced by TerrainTexturePlugin at CUSTOM_FRAGMENT_DEFINITIONS
// after the hex include, inside its TERRAINTEX guard, so latticeHash is in
// scope. Every constant mirrors groundHexParams.ts and a lockstep test
// asserts they agree.
//
// The clump noise is the macro noise's lattice hash on cells wrapped to
// FAR_CLUMP_WRAP, so the hash's product term stays under the bound where the
// CPU twin agrees with it, anywhere in the world.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.

#ifdef TERRAINFARLOW
const vec2 FAR_COVER_BAND = vec2(14.4, 18.0);
#else
const vec2 FAR_COVER_BAND = vec2(24.0, 30.0);
#endif
const vec2 FAR_SWARD_COVER = vec2(0.05, 0.5);
// Fitted 2026-10-10: Full pull toward the far target. With the pull at 0.8 a
// fifth of the ground's own colour stays, and at the meadow pose at noon that
// fifth with the sky's light already matched the card band's luminance, so the
// colour at its floor met the luminance bar and missed chroma and G/R. At 1.0
// the fit lands within 1 % of the band.
const float FAR_SWARD_MAX = 1.0;
// Fitted 2026-10-10: solved at (0.0066, 0.0235, 0.005) and committed at its
// +10 % edge for the low sun. At the meadow pose at noon the far crops read
// Y 0.04177 against the card band's 0.03814, chroma 0.2103 against 0.2128.
const vec3 FAR_SWARD = vec3(0.0073, 0.0258, 0.0055);
// Not fitted 2026-10-10: kept at its start: the canopy fit reached its target
// through the canopy shade alone, and the litter share along the far crops was
// not read from the simulation.
const vec3 FAR_LITTER = vec3(0.081, 0.057, 0.032);
// Fitted 2026-10-10: At the canopy pose at noon the far crops read Y 0.02630
// against the card band's 0.02573. At the canopy pose at 16:00 far over near
// reached 0.77 with the cut at 0.25 and the colour at its +10 % edge, short of
// 0.8. The canopy far crops' chroma reads 0.23 of the band's because those
// crops carry trunks and fog.
const float FAR_CANOPY_SHADE = 0.4615;
const vec2 FAR_CLUMP_CELL = vec2(0.8, 3.0);
const vec2 FAR_CLUMP_WEIGHT = vec2(0.6, 0.4);
const vec2 FAR_CLUMP_SALT = vec2(41.0, 17.0);
const float FAR_CLUMP_WRAP = 97.0;
const float FAR_CLUMP_AO = 0.65;
const float FAR_CLUMP_TILT = 0.67;
const float FAR_COVER_TILT = 0.3;
// Fitted 2026-10-10: At the canopy pose at 16:00 far over near is 0.77 at a cut
// of 0.25.
const float FAR_SPEC_CUT = 0.25;

// The far cover's weight in [0, 1]: any cover the near field draws, grass or
// litter, ramped in over the tier's band of eye distance. Mirrors
// farCoverWeight.
float farCoverWeight(float cover, float duff, float dist) {
  float key = clamp(cover + duff, 0.0, 1.0);
  return smoothstep(FAR_SWARD_COVER.x, FAR_SWARD_COVER.y, key) * smoothstep(FAR_COVER_BAND.x, FAR_COVER_BAND.y, dist);
}

// One octave of value noise and its gradient in cell units: xy the
// gradient, z the value in [0, 1]. Mirrors farClumpOctave.
vec3 farClumpOctave(vec2 p, float cell, vec2 salt) {
  vec2 q = p / cell;
  vec2 c = floor(q);
  vec2 f = q - c;
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  vec2 c0 = mod(c + salt, FAR_CLUMP_WRAP);
  vec2 c1 = mod(c + salt + 1.0, FAR_CLUMP_WRAP);
  float a = latticeHash(c0);
  float b = latticeHash(vec2(c1.x, c0.y));
  float d = latticeHash(vec2(c0.x, c1.y));
  float e = latticeHash(c1);
  float k = a - b - d + e;
  float n = a + (b - a) * u.x + (d - a) * u.y + k * u.x * u.y;
  return vec3(du.x * (b - a + k * u.y), du.y * (d - a + k * u.x), n);
}

// The two octaves, each faded to its mean where its cell spans under two
// pixels. foot is the pixel's footprint on the ground in metres. The fade is
// written as 1.0 minus a rising smoothstep because GLSL leaves smoothstep
// undefined for a first edge above the second. Mirrors farClump.
vec3 farClump(vec2 p, float foot) {
  vec3 o1 = farClumpOctave(p, FAR_CLUMP_CELL.x, vec2(0.0));
  vec3 o2 = farClumpOctave(p, FAR_CLUMP_CELL.y, FAR_CLUMP_SALT);
  float b1 = FAR_CLUMP_WEIGHT.x * (1.0 - smoothstep(0.5, 1.0, foot / FAR_CLUMP_CELL.x));
  float b2 = FAR_CLUMP_WEIGHT.y * (1.0 - smoothstep(0.5, 1.0, foot / FAR_CLUMP_CELL.y));
  return vec3(b1 * o1.xy + b2 * o2.xy, 0.5 + b1 * (o1.z - 0.5) + b2 * (o2.z - 0.5));
}
