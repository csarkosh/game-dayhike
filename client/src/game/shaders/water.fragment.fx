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
#ifndef OCEAN
// The lake's mirror (lakeMirror.fragment.fx), declared on a lake alone: the
// sea binds a placeholder to a name its stages never declare.
uniform sampler2D waterMirror;
// The lake's shore on medium and low (lakeMirror.fragment.fx), on a lake
// alone too: the panorama, half float, and the skyline, a 32-bit float a
// texel.
uniform sampler2D waterPanorama;
uniform highp sampler2D waterSkyline;
#endif

varying float vBedDepth;
// The surface's view depth in metres, from the vertex stage.
varying float vWaterViewDepth;

const float WATER_F0 = 0.02;
const float WATER_HORIZON = 0.02;
const float WATER_REFRACT = 0.02;
const float WATER_REFRACT_DEPTH = 1.0;
// The second ripple octave: metres a tile, its share of the first's slope,
// and its drift in tiles per second along the wind (spec §5.3).
const float WATER_OCTAVE2_TILE = 3.0;
const float WATER_OCTAVE2_WEIGHT = 0.333;
const float WATER_OCTAVE2_DRIFT = 0.04;
// The skin's drift in metres per second along the wind. It is carried by the wind's integral over the run,
// so a day's run offsets the pattern by a few thousand metres, the order of the world coordinates the hash takes
const float WATER_SKIN_DRIFT = 0.04;
// The rain's rings, the puddles' own: a ring's radius as a share of its cell,
// and how far in from the cell's edges its centre sits at least. These and
// the four layers' numbers in waterRainSlope mirror RIPPLE_RADIUS,
// RIPPLE_INSET and RIPPLE_LAYERS in rainParams.ts, and a test holds them equal.
const float WATER_RAIN_RADIUS = 0.25;
const float WATER_RAIN_INSET = 0.25;

// The second octave's slope from the same bump texture at a finer tile,
// drifting with the wind. The first octave is PBR's own bump (24 m a tile,
// scrolled by the shell). Returns an xz slope to add to the normal.
vec2 waterRipple2(vec2 xz) {
  vec2 uv = xz / WATER_OCTAVE2_TILE + waterWindTime * WATER_OCTAVE2_DRIFT;
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

// The skin: duckweed and algae mats on a murky lake. A value noise on the unit
// lattice (a hash without sine, which loses precision at world coordinates),
// the lake's seed offsetting it.
float waterSkinHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float waterSkinNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = waterSkinHash(i);
  float b = waterSkinHash(i + vec2(1.0, 0.0));
  float c = waterSkinHash(i + vec2(0.0, 1.0));
  float d = waterSkinHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Where the skin lies, 0 to 1: duckweed in drifts on the sheltered shallows,
// under 1.5 m, and algae in clumped mats along the margin, under 0.4 m.
float waterSkinMask(vec2 xz, float depth) {
  if (waterSkin.x <= 0.0) return 0.0;
  vec2 p = xz + waterSkin.y - waterWindTime * WATER_SKIN_DRIFT;
  float drift = waterSkinNoise(p / 9.0) * 0.65 + waterSkinNoise(p / 3.0) * 0.35;
  float duckweed = smoothstep(0.55, 0.62, drift) * (1.0 - smoothstep(0.9, 1.5, depth));
  float algae = smoothstep(0.5, 0.58, waterSkinNoise(p / 1.6)) * (1.0 - smoothstep(0.15, 0.4, depth));
  return waterSkin.x * max(duckweed, algae);
}

// The skin's colour: duckweed's bright fronds, finely speckled near the eye
// and evened out with distance so the speckle never shimmers, and the
// yellower algae where the mats clump.
vec3 waterSkinColour(vec2 xz, float viewDepth) {
  vec2 p = xz + waterSkin.y - waterWindTime * WATER_SKIN_DRIFT;
  float frond = mix(waterSkinNoise(p * 7.0), 0.5, smoothstep(10.0, 40.0, viewDepth));
  vec3 duckweed = mix(vec3(0.16, 0.26, 0.05), vec3(0.24, 0.34, 0.07), frond);
  vec3 algae = vec3(0.30, 0.32, 0.10);
  return mix(duckweed, algae, 0.5 * smoothstep(0.4, 0.6, waterSkinNoise(p / 1.6)));
}

// One layer of the rain's rings, line for line the puddles' layer in
// trailPaint.ts on the water's own hash: the plane cut into cells at scale a
// metre, one ring a cell, its centre and its phase hashed from the cell
// folded to 512, the phase run at timeMul cycles a second from timeAdd. The
// layer blends in over its quarter of the rain. Returns its xz slope.
vec2 waterRainLayer(vec2 xz, float t, float layer, float scale, vec2 offset, float timeMul, float timeAdd) {
  vec2 p = xz * scale + offset;
  vec2 c = floor(p);
  vec2 h = mod(c, 512.0);
  vec2 centre = vec2(waterSkinHash(h + vec2(37.0, 0.0)), waterSkinHash(h + vec2(0.0, 91.0))) * (1.0 - 2.0 * WATER_RAIN_INSET) + WATER_RAIN_INSET;
  vec2 d = p - c - centre;
  float dist = length(d);
  float r = clamp(1.0 - dist / WATER_RAIN_RADIUS, 0.0, 1.0);
  vec2 dir = d / max(dist, 0.0001);
  float w = clamp(waterRain * 4.0 - layer, 0.0, 1.0);
  float drop = fract(waterSkinHash(h) + t * timeMul + timeAdd);
  float rt = drop - 1.0 + r;
  float f = clamp(0.2 + w * 0.8 - drop, 0.0, 1.0);
  return dir * f * r * sin(clamp(rt * 9.0, 0.0, 3.0) * 3.14159) * 0.35;
}

// The rain's rings at world xz, their xz slope: four layers, as on the
// puddles. None without rain, a branch on the uniform. The time folds by the
// hour as rippleTime does on the CPU, every layer's rate a whole number of
// cycles in it, so the fold keeps the t times timeMul product precise and no ring jumps.
vec2 waterRainSlope(vec2 xz) {
  if (waterRain <= 0.0) return vec2(0.0);
  float t = mod(waterTime, 3600.0);
  return waterRainLayer(xz, t, 0.0, 2.5, vec2(0.0, 0.0), 1.0, 0.0)
    + waterRainLayer(xz, t, 1.0, 3.2, vec2(0.37, 0.61), 0.85, 0.2)
    + waterRainLayer(xz, t, 2.0, 2.1, vec2(0.71, 0.13), 0.93, 0.45)
    + waterRainLayer(xz, t, 3.0, 3.8, vec2(0.19, 0.83), 1.13, 0.7);
}
