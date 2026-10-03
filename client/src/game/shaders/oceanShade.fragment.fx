#ifdef OCEAN
// Water plugin, the sea's shading: fragment definitions spliced after the
// sea's surface (oceanSurface.fx), for the code under OCEAN in
// waterLights.fragment.fx, waterCompose.fragment.fx and the roughness line.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The literals mirror waterShading.ts and a lockstep test asserts they agree.
// Cox and Munk's slope variance, A + B U, and the least the sea keeps for its
// roughness however much the drawn waves carry: half the calm intercept, so
// a glassy sea's glint stays wider than a pixel.
const float WATER_COX_MUNK_A = 0.003;
const float WATER_COX_MUNK_B = 0.00512;
const float OCEAN_SLOPE_VAR_FLOOR = 0.0015;

// The slope variance the roughness carries: Cox and Munk's for the wind sea's
// wind, scaled by the shelter, less the variance the drawn waves already put
// in the normal.
float oceanUndrawnVariance(float u10, float shelter, float drawn) {
  return max((WATER_COX_MUNK_A + WATER_COX_MUNK_B * u10) * shelter - drawn, OCEAN_SLOPE_VAR_FLOOR);
}

// The white water's look: fresh foam's albedo and old foam's, the lace's
// cell (m), its drift along the swell's travel (m/s) and its edge's softness.
const float OCEAN_FOAM_ALBEDO = 0.8;
const float OCEAN_FOAM_ALBEDO_OLD = 0.5;
const float OCEAN_LACE_TILE = 3.0;
const float OCEAN_LACE_DRIFT = 0.4;
const float OCEAN_LACE_SOFT = 0.06;
// The whitecaps where no wind sea is drawn: a cap a cell (m), each cell's
// cycle (s), a cap's radius and its centre's least inset (in cells), the
// cells' drift down the wind (m/s), and the cover a cell gives when its cap
// fires every cycle, its area's share times its mean brightness.
const float OCEAN_CAP_CELL = 5.0;
const float OCEAN_CAP_PERIOD = 5.0;
const float OCEAN_CAP_RADIUS = 0.3;
const float OCEAN_CAP_INSET = 0.3;
const float OCEAN_CAP_DRIFT = 2.0;
const float OCEAN_CAP_SHARE = 0.1028;
// The whitecaps on a drawn wind sea: their soft edge, in standard deviations
// of its height.
const float OCEAN_CAP_SOFT = 0.4;

// The foam's lace at p: two octaves of ridged noise, near 1 along the lines
// of a net, drifting with the swell's travel and offset by the world's seed
// (the sea's waterSkin.y, its skin itself off).
float oceanLace(vec2 p) {
  vec2 q = p + waterSkin.y - oceanSwell.xy * (OCEAN_LACE_DRIFT * waterTime);
  float a = 1.0 - abs(2.0 * waterSkinNoise(q / OCEAN_LACE_TILE) - 1.0);
  float b = 1.0 - abs(2.0 * waterSkinNoise(q / (0.37 * OCEAN_LACE_TILE) + 19.0) - 1.0);
  return 0.65 * a + 0.35 * b;
}

// The share of the surface the foam covers: its amount through the lace, a
// sheet where it is fresh and full, a net of thinning lines as it ages. Where
// a lace cell spans under a few pixels the amount stands in for it, so the
// net never shimmers.
float oceanFoamCover(vec2 p, float foam, float pixel) {
  float lace = smoothstep(1.0 - foam, 1.0 - foam + OCEAN_LACE_SOFT, oceanLace(p));
  return mix(lace, foam, smoothstep(0.1, 0.4, pixel / OCEAN_LACE_TILE));
}

// The foam's albedo by its age: fresh foam's, falling to old foam's.
float oceanFoamWhite(float foamAge) {
  return mix(OCEAN_FOAM_ALBEDO_OLD, OCEAN_FOAM_ALBEDO, exp(-foamAge / OCEAN_FOAM_LIFE));
}

// The whitecaps' coverage at p: Callaghan's for the wind (oceanWind.w), less
// in a headland's lee as the chop is.
float oceanCapCoverage(vec2 p) {
  return oceanWind.w * oceanShelter(p, SHELTER_CHOP);
}

// How many standard deviations above its mean a Gaussian sea's height stands
// over the coverage's share of the surface: Abramowitz and Stegun's 26.2.23,
// within 4.5e-4.
float oceanCapThreshold(float coverage) {
  float s = sqrt(-2.0 * log(clamp(coverage, 1.0e-6, 0.5)));
  return s - (2.515517 + 0.802853 * s + 0.010328 * s * s) / (1.0 + 1.432788 * s + 0.189269 * s * s + 0.001308 * s * s * s);
}

// A whitecap at p on a drawn wind sea whose height there is crest standard
// deviations above its mean: white over the coverage's top share of the
// crests, so the caps cover what Callaghan's fraction says and flash and
// fade as each crest rises through the threshold and falls back.
float oceanWhitecap(vec2 p, float crest) {
  float coverage = oceanCapCoverage(p);
  float t = oceanCapThreshold(coverage);
  return smoothstep(t - 0.5 * OCEAN_CAP_SOFT, t + 0.5 * OCEAN_CAP_SOFT, crest) * step(1.0e-6, coverage);
}

// Whitecaps where no wind sea is drawn, the same coverage by construction: a
// cap a cell, its centre and its cycle's phase hashed from the cell (folded
// to 512, as the rain's rings are), the cells drifting down the wind. In each
// cycle the cap fires with the chance coverage over OCEAN_CAP_SHARE, flashes
// white and fades through the cycle. The cycle folds by the hour, a whole
// number of cycles in it.
float oceanCapCells(vec2 p) {
  vec2 q = (p + waterSkin.y - waterWindTime * OCEAN_CAP_DRIFT) / OCEAN_CAP_CELL;
  vec2 c = floor(q);
  vec2 h = mod(c, 512.0);
  vec2 centre = vec2(waterSkinHash(h + vec2(13.0, 0.0)), waterSkinHash(h + vec2(0.0, 57.0))) * (1.0 - 2.0 * OCEAN_CAP_INSET) + OCEAN_CAP_INSET;
  float cycle = mod(waterTime, 3600.0) / OCEAN_CAP_PERIOD + waterSkinHash(h);
  float k = floor(cycle);
  float fire = step(waterSkinHash(h + vec2(mod(k, 97.0) * 3.0, 7.0)), oceanCapCoverage(p) / OCEAN_CAP_SHARE);
  float r = length(q - c - centre) / OCEAN_CAP_RADIUS;
  return fire * (1.0 - (cycle - k)) * (1.0 - smoothstep(0.7, 1.0, r));
}
#endif
