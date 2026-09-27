// Mirrored exactly by latticeHash in groundHexParams.ts.
float latticeHash(vec2 c) {
  return fract(0.618034 * c.x + 0.381966 * c.y + 0.0113 * c.x * c.y);
}

float macroValueNoise(vec2 p, float wave) {
  vec2 q = p / wave;
  vec2 c = floor(q);
  vec2 f = smoothstep(0.0, 1.0, q - c);
  float a = latticeHash(c);
  float b = latticeHash(c + vec2(1.0, 0.0));
  float d = latticeHash(c + vec2(0.0, 1.0));
  float e = latticeHash(c + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}

float macroNoise(vec2 p) {
  return MACRO_WEIGHT.x * macroValueNoise(p, MACRO_WAVE.x) + MACRO_WEIGHT.y * macroValueNoise(p, MACRO_WAVE.y);
}

// slope is 1 minus the ground normal's y. Mirrors macroTint in groundHexParams.ts.
vec3 macroTint(float noise, float slope) {
  float m = clamp(noise + MACRO_SLOPE * clamp(slope, 0.0, 1.0), 0.0, 1.0);
  return mix(MACRO_LUSH, MACRO_DRY, m);
}

// terrainHorizon = (start, end, max). Mirrors horizonWeight.
float horizonWeight(float dist) {
  return terrainHorizon.z * smoothstep(terrainHorizon.x, terrainHorizon.y, dist);
}
