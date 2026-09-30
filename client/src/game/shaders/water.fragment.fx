// Water plugin, fragment definitions. Spliced at CUSTOM_FRAGMENT_DEFINITIONS
// on both the UBO and non-UBO paths, which is why the samplers are declared
// here and not in getUniforms().fragment (the atmosphere.ts precedent).
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The literals mirror waterShading.ts and a lockstep test asserts they agree.
uniform sampler2D waterBedHeight;
uniform sampler2D waterScene;
uniform sampler2D waterDepth;

varying float vBedDepth;

// Task 6 replaces this with the vertex stage's view depth.
float waterViewDepth = 0.0;

const float WATER_F0 = 0.02;
const float WATER_HORIZON = 0.02;
const float WATER_REFRACT = 0.02;
const float WATER_REFRACT_DEPTH = 1.0;
// The second ripple octave: metres a tile, its share of the first's slope,
// and its drift in tiles per second along the wind (spec §5.3).
const float WATER_OCTAVE2_TILE = 3.0;
const float WATER_OCTAVE2_WEIGHT = 0.333;
const float WATER_OCTAVE2_DRIFT = 0.04;

// The second octave's slope from the same bump texture at a finer tile,
// drifting with the wind. The first octave is PBR's own bump (24 m a tile,
// scrolled by the shell). Returns an xz slope to add to the normal.
vec2 waterRipple2(vec2 xz) {
  vec2 uv = xz / WATER_OCTAVE2_TILE + waterWind * waterTime * WATER_OCTAVE2_DRIFT;
#ifdef BUMP
  vec3 n = texture2D(bumpSampler, uv).xyz * 2.0 - 1.0;
  return n.xy * WATER_OCTAVE2_WEIGHT;
#else
  return vec2(0.0);
#endif
}

// Bed height under world xz from the R32F square, bilinear by hand: r32float
// is not filterable on WebGPU and OES_texture_float_linear is not a given on
// WebGL2, so the texture is sampled nearest and blended here. Outside the
// square the ring vertex's depth stands in (it is coarse but it is deep).
float waterBedDepth(vec2 xz) {
  vec2 local = (xz - waterBed.xy) * waterBed.z;
  // Every read happens on every path: a texture read inside a branch on a
  // varying is non-uniform control flow, which the WebGPU compiler refuses.
  vec2 t = clamp(local, 0.0, 1.0) * waterBedTexels - 0.5;
  vec2 i = floor(t);
  vec2 f = t - i;
  vec2 texel = vec2(1.0 / waterBedTexels);
  vec2 uv0 = (i + 0.5) * texel;
  float h00 = texture2D(waterBedHeight, uv0).r;
  float h10 = texture2D(waterBedHeight, uv0 + vec2(texel.x, 0.0)).r;
  float h01 = texture2D(waterBedHeight, uv0 + vec2(0.0, texel.y)).r;
  float h11 = texture2D(waterBedHeight, uv0 + texel).r;
  float h = mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
  bool outside = local.x <= 0.0 || local.y <= 0.0 || local.x >= 1.0 || local.y >= 1.0;
  return outside ? vBedDepth : waterLevel - h;
}

// Tilts a ripple normal so the reflected ray clears the horizon: the
// reflection is lifted to y = WATER_HORIZON with its xz shortened to keep it
// unit, and the normal that reflects the view exactly onto that ray is the
// half-vector. One step, no loop. Mirrors horizonSafeNormal in
// waterShading.ts exactly.
vec3 waterHorizonNormal(vec3 n, vec3 view) {
  vec3 r = reflect(-view, n);
  if (r.y >= WATER_HORIZON) return n;
  float xz = length(r.xz);
  if (xz < 1.0e-4) {
    r = vec3(0.0, 1.0, 0.0);
  } else {
    r.xz *= sqrt(1.0 - WATER_HORIZON * WATER_HORIZON) / xz;
    r.y = WATER_HORIZON;
  }
  return normalize(view + r);
}
