// The grass floor's GLSL: hex tiling (a triangular lattice over the texture
// repeat, three samples at hashed offsets and rotations, sharpened weights),
// the lattice hash and the two-octave macro noise the lush/dry tint rides on,
// and the horizon tint's weight. Spliced by TerrainTexturePlugin at
// CUSTOM_FRAGMENT_DEFINITIONS after its own uniform declarations, so the
// functions below may read terrainHorizon. Every constant mirrors
// groundHexParams.ts and a lockstep test asserts they agree.
//
// The hex offsets use a sin hash that only the GPU evaluates. The macro noise
// uses the multiply-add-fract lattice hash the CPU mirrors exactly, because the
// tufts sample the same tint on the CPU and must agree with the floor.
//
// Samples take explicit gradients of the UNROTATED uv, so a hex seam changes
// the texel fetched but not the mip level, and no seam shows as a blur line.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.

const float HEX_LATTICE = 1.0;
const float HEX_SHARPNESS = 8.0;
const mat2 HEX_SKEW = mat2(1.0, 0.0, -0.57735027, 1.15470054);
const mat2 HEX_UNSKEW = mat2(1.0, 0.0, 0.5, 0.8660254);
const vec2 MACRO_WAVE = vec2(18.0, 6.0);
const vec2 MACRO_WEIGHT = vec2(0.65, 0.35);
const float MACRO_SLOPE = 0.6;
const vec3 MACRO_LUSH = vec3(0.92, 1.03, 0.9);
const vec3 MACRO_DRY = vec3(1.08, 1.0, 0.82);
const float HEX_TAU = 6.28318531;

// GPU-only: offsets and rotations per lattice vertex. Not mirrored.
float hexHash(vec2 v, float salt) {
  return fract(sin(dot(v + salt, vec2(127.1, 311.7))) * 43758.5453);
}

// The lattice triangle the uv falls in: three integer vertices in skewed
// space and their barycentric weights. Mirrors hexTriangle in groundHexParams.ts.
void hexTriangle(vec2 uv, out vec2 v1, out vec2 v2, out vec2 v3, out vec3 w) {
  vec2 s = HEX_SKEW * (uv * HEX_LATTICE);
  vec2 b = floor(s);
  vec2 f = s - b;
  if (f.x + f.y < 1.0) {
    v1 = b;
    v2 = b + vec2(1.0, 0.0);
    v3 = b + vec2(0.0, 1.0);
    w = vec3(1.0 - f.x - f.y, f.x, f.y);
  } else {
    v1 = b + vec2(1.0, 1.0);
    v2 = b + vec2(1.0, 0.0);
    v3 = b + vec2(0.0, 1.0);
    w = vec3(f.x + f.y - 1.0, 1.0 - f.y, 1.0 - f.x);
  }
}

// The uv to fetch for vertex v: rotate about the vertex, then offset, both hashed.
vec2 hexUv(vec2 uv, vec2 v) {
  vec2 vp = (HEX_UNSKEW * v) / HEX_LATTICE;
  float a = hexHash(v, 0.0) * HEX_TAU;
  float ca = cos(a);
  float sa = sin(a);
  vec2 d = uv - vp;
  vec2 o = vec2(hexHash(v, 7.3), hexHash(v, 13.1));
  return vec2(ca * d.x - sa * d.y, sa * d.x + ca * d.y) + o;
}

vec3 hexWeightsSharp(vec3 w) {
  vec3 s = pow(max(w, vec3(0.0)), vec3(HEX_SHARPNESS));
  return s / max(s.x + s.y + s.z, 1.0e-9);
}

// Everything a hex fetch needs that depends on the uv alone: the three hashed
// uvs and the sharpened weights. Nine sin hashes and a lattice walk, so a
// caller sampling several maps at ONE scale calls this once and hands the
// result to as many fetchers as it likes.
void hexSetup(vec2 uv, out vec2 u1, out vec2 u2, out vec2 u3, out vec3 s) {
  vec2 v1; vec2 v2; vec2 v3; vec3 w;
  hexTriangle(uv, v1, v2, v3, w);
  u1 = hexUv(uv, v1);
  u2 = hexUv(uv, v2);
  u3 = hexUv(uv, v3);
  s = hexWeightsSharp(w);
}

// One hex-tiled fetch of a 2D texture from a prepared lattice. dx, dy are the
// gradients of the plain uv.
vec3 hexFetch2D(sampler2D tex, vec2 u1, vec2 u2, vec2 u3, vec3 s, vec2 dx, vec2 dy) {
  return textureGrad(tex, u1, dx, dy).rgb * s.x
       + textureGrad(tex, u2, dx, dy).rgb * s.y
       + textureGrad(tex, u3, dx, dy).rgb * s.z;
}

// The same for one layer of a 2D array (the relief maps).
vec3 hexFetchArray(highp sampler2DArray tex, vec2 u1, vec2 u2, vec2 u3, vec3 s, float layer, vec2 dx, vec2 dy) {
  return textureGrad(tex, vec3(u1, layer), dx, dy).rgb * s.x
       + textureGrad(tex, vec3(u2, layer), dx, dy).rgb * s.y
       + textureGrad(tex, vec3(u3, layer), dx, dy).rgb * s.z;
}

// The one-shot spellings: lattice and fetch together, for a lone sample.
vec3 hexSample2D(sampler2D tex, vec2 uv, vec2 dx, vec2 dy) {
  vec2 u1; vec2 u2; vec2 u3; vec3 s;
  hexSetup(uv, u1, u2, u3, s);
  return hexFetch2D(tex, u1, u2, u3, s, dx, dy);
}

vec3 hexSampleArray(highp sampler2DArray tex, vec2 uv, float layer, vec2 dx, vec2 dy) {
  vec2 u1; vec2 u2; vec2 u3; vec3 s;
  hexSetup(uv, u1, u2, u3, s);
  return hexFetchArray(tex, u1, u2, u3, s, layer, dx, dy);
}

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
