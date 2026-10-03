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

// The white water's look: fresh foam's albedo and old foam's, and the share of
// the surface fresh foam reflects (what its lace of OCEAN_FOAM_ALBEDO covers is
// that over the albedo). The foam's lace thins by a factor e every
// OCEAN_LACE_THIN seconds (8.08 solved, to one decimal) so a lone bore's
// trailing foam, ten seconds on, reflects 6 %. The lace's cell (m), its drift
// along the swell's travel (m/s) and its edge's softness.
const float OCEAN_FOAM_ALBEDO = 0.8;
const float OCEAN_FOAM_ALBEDO_OLD = 0.5;
const float OCEAN_FOAM_REFLECT_FRESH = 0.4;
const float OCEAN_LACE_THIN = 8.1;
const float OCEAN_LACE_TILE = 3.0;
const float OCEAN_LACE_DRIFT = 0.4;
const float OCEAN_LACE_SOFT = 0.06;
// The lace's noise: the coarse octave's weight (the fine octave has the rest),
// the fine octave's cell as a fraction of the coarse one's, and its shift. The
// level a given cover lies above, as a polynomial in the cover's square root,
// fitted to the noise's measured quantiles (error under 0.003 for covers to a
// half, with the soft edge centred on it), and the cover under which the lace
// is held back, so none shows where there is no foam.
const float OCEAN_LACE_WEIGHT = 0.65;
const float OCEAN_LACE_FINE = 0.37;
const float OCEAN_LACE_FINE_SHIFT = 19.0;
const float OCEAN_LACE_FIT_A = 0.4313;
const float OCEAN_LACE_FIT_B = -0.0802;
const float OCEAN_LACE_FIT_C = 0.2164;
const float OCEAN_LACE_ONSET = 0.01;
// A pattern is drawn whole while a pixel spans under a tenth of its size and
// has faded to its mean by two fifths of it.
const float OCEAN_DETAIL_LO = 0.1;
const float OCEAN_DETAIL_HI = 0.4;
// The whitecaps where no wind sea is drawn: a cap a cell (m), each cell's
// cycle (s), a cap's radius and its centre's least inset (in cells), the
// cells' drift down the wind (m/s), the cover a cell gives when its cap fires
// every cycle (its area's share times its mean brightness), and the cycles
// after which the hashed pattern of which caps fire repeats.
const float OCEAN_CAP_CELL = 5.0;
const float OCEAN_CAP_PERIOD = 5.0;
const float OCEAN_CAP_RADIUS = 0.3;
const float OCEAN_CAP_INSET = 0.3;
const float OCEAN_CAP_DRIFT = 2.0;
const float OCEAN_CAP_SHARE = 0.1028;
const float OCEAN_CAP_CYCLES = 97.0;
// The whitecaps on a drawn wind sea: their soft edge, in standard deviations
// of its height.
const float OCEAN_CAP_SOFT = 0.4;

// The foam's lace at p: two octaves of ridged noise, near 1 along the lines
// of a net, drifting with the swell's travel and offset by the world's seed
// (the sea's waterSkin.y, its skin itself off).
float oceanLace(vec2 p) {
  vec2 q = p + waterSkin.y - oceanSwell.xy * (OCEAN_LACE_DRIFT * waterTime);
  float a = 1.0 - abs(2.0 * waterSkinNoise(q / OCEAN_LACE_TILE) - 1.0);
  float b = 1.0 - abs(2.0 * waterSkinNoise(q / (OCEAN_LACE_FINE * OCEAN_LACE_TILE) + OCEAN_LACE_FINE_SHIFT) - 1.0);
  return OCEAN_LACE_WEIGHT * a + (1.0 - OCEAN_LACE_WEIGHT) * b;
}

// The age the foam's look goes by: the time since the crest passed, except on
// the spilling roll at the crest's front face, where the swell's age has
// wrapped to nearly a whole period and the foam is fresh.
float oceanFoamLookAge(float foamAge) {
  float ahead = OCEAN_TWO_PI - foamAge * (OCEAN_TWO_PI / oceanSwell.z);
  return foamAge * smoothstep(0.0, OCEAN_ROLL_WIDTH, ahead);
}

// The share of the surface a foam's lace covers on average: the foam's amount
// times the share a full, fresh foam covers, thinning with its age.
float oceanFoamShare(float foam, float lookAge) {
  return foam * (OCEAN_FOAM_REFLECT_FRESH / OCEAN_FOAM_ALBEDO) * exp(-lookAge / OCEAN_LACE_THIN);
}

// The lace's value that a share of the surface lies above: the quantile at
// one less the share, in closed form.
float oceanLaceLevel(float share) {
  float s = sqrt(clamp(share, 0.0, 0.5));
  return 1.0 - s * (OCEAN_LACE_FIT_A + s * (OCEAN_LACE_FIT_B + s * OCEAN_LACE_FIT_C));
}

// The share of the surface the foam covers: the lace above the level that
// leaves the foam's share of it, so the mean cover is that share, a net of
// thinning lines as the foam ages. Where a lace cell spans under a few pixels
// the share stands in for it, so the net never shimmers and the surf keeps
// its brightness across the distance.
float oceanFoamCover(vec2 p, float foam, float lookAge, float pixel) {
  float share = oceanFoamShare(foam, lookAge);
  float level = oceanLaceLevel(share);
  float lace = smoothstep(level - 0.5 * OCEAN_LACE_SOFT, level + 0.5 * OCEAN_LACE_SOFT, oceanLace(p)) * smoothstep(0.0, OCEAN_LACE_ONSET, share);
  return mix(lace, share, smoothstep(OCEAN_DETAIL_LO, OCEAN_DETAIL_HI, pixel / OCEAN_LACE_TILE));
}

// The foam's albedo by its age: fresh foam's, falling to old foam's.
float oceanFoamWhite(float lookAge) {
  return mix(OCEAN_FOAM_ALBEDO_OLD, OCEAN_FOAM_ALBEDO, exp(-lookAge / OCEAN_FOAM_LIFE));
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

// Whether a cell's cap fires in cycle k, 1 or 0: its hash, drawn afresh every
// cycle by a shift of the cell that is itself hashed from the cycle, so no two
// cycles share a pattern or a neighbour's. It fires only while the hash is
// under the chance, so a chance of none never fires. The cycle counts from 0
// to OCEAN_CAP_CYCLES.
float oceanCapFire(vec2 h, float k, float chance) {
  float n = mod(k, OCEAN_CAP_CYCLES);
  vec2 shift = vec2(waterSkinHash(vec2(n, 31.0)), waterSkinHash(vec2(n, 77.0))) * 512.0;
  return 1.0 - step(chance, waterSkinHash(h + shift));
}

// Whitecaps where no wind sea is drawn, the same coverage by construction: a
// cap a cell, its centre and its cycle's phase hashed from the cell (folded
// to 512, as the rain's rings are), the cells drifting down the wind. In each
// cycle the cap fires with the chance coverage over OCEAN_CAP_SHARE, the
// coverage taken at the cap's centre so a lee's gradient never cuts a cap,
// flashes white and fades through the cycle. The clock folds by
// OCEAN_CAP_CYCLES periods, the pattern's own repeat, so no cycle is ever cut
// short. Where a cap spans under a few pixels the coverage stands in for it.
float oceanCapCells(vec2 p, float pixel) {
  vec2 q = (p + waterSkin.y - waterWindTime * OCEAN_CAP_DRIFT) / OCEAN_CAP_CELL;
  vec2 c = floor(q);
  vec2 h = mod(c, 512.0);
  vec2 centre = vec2(waterSkinHash(h + vec2(13.0, 0.0)), waterSkinHash(h + vec2(0.0, 57.0))) * (1.0 - 2.0 * OCEAN_CAP_INSET) + OCEAN_CAP_INSET;
  vec2 at = (c + centre) * OCEAN_CAP_CELL - waterSkin.y + waterWindTime * OCEAN_CAP_DRIFT;
  float cycle = mod(waterTime, OCEAN_CAP_CYCLES * OCEAN_CAP_PERIOD) / OCEAN_CAP_PERIOD + waterSkinHash(h);
  float k = floor(cycle);
  float fire = oceanCapFire(h, k, oceanCapCoverage(at) / OCEAN_CAP_SHARE);
  float r = length(q - c - centre) / OCEAN_CAP_RADIUS;
  float cap = fire * (1.0 - (cycle - k)) * (1.0 - smoothstep(0.7, 1.0, r));
  return mix(cap, oceanCapCoverage(p), smoothstep(OCEAN_DETAIL_LO, OCEAN_DETAIL_HI, pixel / (2.0 * OCEAN_CAP_RADIUS * OCEAN_CAP_CELL)));
}
#endif
