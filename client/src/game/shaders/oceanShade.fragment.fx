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

// The white water's look, two things apart. A foam's brightness, its albedo, is
// OCEAN_FOAM_ALBEDO when fresh and falls toward OCEAN_FOAM_ALBEDO_OLD with the
// time since its crest, by a factor e every OCEAN_FOAM_FADE seconds (4.7, which
// puts it at 0.1 ten seconds on: spec 5's fresh foam reflecting about 40 % and
// old foam 3 to 10 %, near the 3.85 s laboratory decay). Its cover,
// the share of the surface it whitens, thins from a sheet to a lace with the
// foam's amount, which itself thins over OCEAN_FOAM_LIFE, down to the inner
// surf's floor: where the broken swell renews the foam every period,
// OCEAN_INNER_COVER of the surface stays in foam, weighted by how broken the
// swell is (foam over 0.35 to 0.55 of the surf zone on average and nearly all
// of its inner part). The lace's cell (m), its drift along the swell's travel
// (m/s) and its edge's softness.
const float OCEAN_FOAM_ALBEDO = 0.4;
const float OCEAN_FOAM_ALBEDO_OLD = 0.06;
const float OCEAN_FOAM_FADE = 4.7;
const float OCEAN_INNER_COVER = 0.6;
const float OCEAN_LACE_TILE = 3.0;
const float OCEAN_LACE_DRIFT = 0.4;
const float OCEAN_LACE_SOFT = 0.06;
// The lace's noise: the coarse octave's weight (the fine octave has the rest),
// the fine octave's cell as a fraction of the coarse one's, and its shift. The
// level a given cover lies above, for covers from none to all: a polynomial in
// the cover's square root, which fits the noise's top tail, and one in the
// fourth root of what the cover leaves, which fits its bottom, fitted to the
// noise's measured quantiles (error under 0.002 in cover, with the soft edge
// centred on it). And the cover under which the lace is held back, so none
// shows where there is no foam.
const float OCEAN_LACE_WEIGHT = 0.65;
const float OCEAN_LACE_FINE = 0.37;
const float OCEAN_LACE_FINE_SHIFT = 19.0;
const float OCEAN_LACE_FIT_A = 0.4334;
const float OCEAN_LACE_FIT_B = -0.1923;
const float OCEAN_LACE_FIT_C = 0.1369;
const float OCEAN_LACE_FIT_D = 0.5144;
const float OCEAN_LACE_FIT_E = 0.1083;
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

// The share of the surface a foam covers on average: the foam's amount, a
// sheet at the roll and thinning with the time since the crest, or the inner
// surf's floor, its breaking weight times OCEAN_INNER_COVER, whichever is the
// more. The inner surf's foam is renewed by every bore, so the floor does not
// thin with age.
float oceanFoamShare(float foam, float breaking) {
  return max(foam, breaking * OCEAN_INNER_COVER);
}

// The lace's value that a share of the surface lies above: the quantile at
// one less the share, in closed form.
float oceanLaceLevel(float share) {
  float c = clamp(share, 0.0, 1.0);
  float s = sqrt(c);
  float p = 1.0 - sqrt(sqrt(1.0 - c));
  return 1.0 - s * (OCEAN_LACE_FIT_A + s * (OCEAN_LACE_FIT_B + s * OCEAN_LACE_FIT_C)) - p * (OCEAN_LACE_FIT_D + p * OCEAN_LACE_FIT_E);
}

// The share of the surface the foam covers: the lace above the level that
// leaves the foam's share of it, so the mean cover is that share, a sheet when
// the foam is full and a net of thinning lines as it thins. Where a lace cell
// spans under a few pixels the share stands in for it, so the net never
// shimmers and the surf keeps its brightness across the distance.
float oceanFoamCover(vec2 p, float foam, float breaking, float pixel) {
  float share = oceanFoamShare(foam, breaking);
  float level = oceanLaceLevel(share);
  float lace = smoothstep(level - 0.5 * OCEAN_LACE_SOFT, level + 0.5 * OCEAN_LACE_SOFT, oceanLace(p)) * smoothstep(0.0, OCEAN_LACE_ONSET, share);
  return mix(lace, share, smoothstep(OCEAN_DETAIL_LO, OCEAN_DETAIL_HI, pixel / OCEAN_LACE_TILE));
}

// The foam's albedo by its age: fresh foam's, falling to old foam's.
float oceanFoamWhite(float lookAge) {
  return mix(OCEAN_FOAM_ALBEDO_OLD, OCEAN_FOAM_ALBEDO, exp(-lookAge / OCEAN_FOAM_FADE));
}

// What cuts the whitecaps at p as it cuts the chop: a headland's lee, and
// share, the wind sea's share of its fully developed height at p
// (oceanWindAmp), which is the fetch's near shore under a wind off the land.
float oceanCapDamp(vec2 p, float share) {
  return oceanShelter(p, SHELTER_CHOP) * min(share, 1.0);
}

// The whitecaps' coverage at p: Callaghan's for the wind (oceanWind.w), cut
// as the chop is, share the wind sea's share at p.
float oceanCapCoverage(vec2 p, float share) {
  return oceanWind.w * oceanCapDamp(p, share);
}

// How many standard deviations above its mean a Gaussian sea's height stands
// over the coverage's share of the surface: Abramowitz and Stegun's 26.2.23,
// within 4.5e-4.
float oceanCapThreshold(float coverage) {
  float s = sqrt(-2.0 * log(clamp(coverage, 1.0e-6, 0.5)));
  return s - (2.515517 + 0.802853 * s + 0.010328 * s * s) / (1.0 + 1.432788 * s + 0.189269 * s * s + 0.001308 * s * s * s);
}

// A whitecap on a drawn wind sea whose height here is crest standard
// deviations above its mean, coverage the whitecaps' coverage here
// (oceanCapCoverage): white over the coverage's top share of the crests, so
// the caps cover what Callaghan's fraction says and flash and fade as each
// crest rises through the threshold and falls back.
float oceanWhitecap(float coverage, float crest) {
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
// share is the wind sea's share at p, the cap's centre taking its own.
float oceanCapCells(vec2 p, float pixel, float share) {
  vec2 q = (p + waterSkin.y - waterWindTime * OCEAN_CAP_DRIFT) / OCEAN_CAP_CELL;
  vec2 c = floor(q);
  vec2 h = mod(c, 512.0);
  vec2 centre = vec2(waterSkinHash(h + vec2(13.0, 0.0)), waterSkinHash(h + vec2(0.0, 57.0))) * (1.0 - 2.0 * OCEAN_CAP_INSET) + OCEAN_CAP_INSET;
  vec2 at = (c + centre) * OCEAN_CAP_CELL - waterSkin.y + waterWindTime * OCEAN_CAP_DRIFT;
  float cycle = mod(waterTime, OCEAN_CAP_CYCLES * OCEAN_CAP_PERIOD) / OCEAN_CAP_PERIOD + waterSkinHash(h);
  float k = floor(cycle);
  float fire = oceanCapFire(h, k, oceanCapCoverage(at, oceanWindAmp(at)) / OCEAN_CAP_SHARE);
  float r = length(q - c - centre) / OCEAN_CAP_RADIUS;
  float cap = fire * (1.0 - (cycle - k)) * (1.0 - smoothstep(0.7, 1.0, r));
  return mix(cap, oceanCapCoverage(p, share), smoothstep(OCEAN_DETAIL_LO, OCEAN_DETAIL_HI, pixel / (2.0 * OCEAN_CAP_RADIUS * OCEAN_CAP_CELL)));
}

// The low tier's bump under the wind sea: its slope a metre of the wind
// sea's height draws, and the most it is scaled.
const float OCEAN_BUMP_HS = 1.0;
const float OCEAN_BUMP_MAX = 2.0;

// The share of a field size metres across, n texels a side, that a pixel of
// pixel metres draws: all while its shortest wave, of wavenumber pi n / size,
// spans four pixels, none from two.
float oceanWindPixelKeep(float size, float n, float pixel) {
  return 1.0 - smoothstep(OCEAN_RESOLVE_PHASE_LO, OCEAN_RESOLVE_PHASE_HI, 0.5 * OCEAN_TWO_PI * n * pixel / size);
}

// The wind sea's slopes at p as a normal's horizontal part (minus the height's
// gradient), each field faded by the pixel's footprint, and in drawn the
// slope variance the drawn fields carry (oceanWindStats.yzw, each field's
// whole). The high tier's from the slope texture, the medium tier's from the
// loop's heights, two taps an axis a texel apart: the loop's heights and
// lengths scale alike with the wind, so its slopes are the bake's.
vec2 oceanWindSlopesAt(vec2 p, float pixel, out float drawn) {
  vec2 w = oceanWindFrame(p);
  vec2 g = vec2(0.0);
  drawn = 0.0;
  if (oceanCoast.w > 1.5) {
    float k0 = oceanWindPixelKeep(FFT_CASCADE_0, FFT_N, pixel);
    float k1 = oceanWindPixelKeep(FFT_CASCADE_1, FFT_N, pixel);
    float k2 = oceanWindPixelKeep(FFT_CASCADE_2, FFT_N, pixel);
    g = textureLod(oceanWindSlope, vec3(w / FFT_CASCADE_0, 0.0), 0.0).xy * k0
      + textureLod(oceanWindSlope, vec3(w / FFT_CASCADE_1, 1.0), 0.0).xy * k1
      + textureLod(oceanWindSlope, vec3(w / FFT_CASCADE_2, 2.0), 0.0).xy * k2;
    drawn = k0 * k0 * oceanWindStats.y + k1 * k1 * oceanWindStats.z + k2 * k2 * oceanWindStats.w;
  } else if (oceanCoast.w > 0.5) {
    float size = oceanLoopSize();
    vec2 uv = w / size;
    float e = 1.0 / LOOP_N;
    float keep = oceanWindPixelKeep(size, LOOP_N, pixel);
    float gx = oceanLoopRead(uv + vec2(e, 0.0)).x - oceanLoopRead(uv - vec2(e, 0.0)).x;
    float gz = oceanLoopRead(uv + vec2(0.0, e)).x - oceanLoopRead(uv - vec2(0.0, e)).x;
    g = vec2(gx, gz) * (LOOP_N / (2.0 * LOOP_SIZE)) * keep;
    drawn = keep * keep * oceanWindStats.y;
  }
  return -oceanFromWind(g);
}

// The wind sea's slopes at p, nothing faded.
vec2 oceanWindSlopes(vec2 p) {
  float drawn;
  return oceanWindSlopesAt(p, 0.0, drawn);
}

// How much of a drawn wind sea's crests a pixel of pixel metres draws, so
// their whitecaps fade to their coverage before the waves that shape them
// fall under the pixel: on the medium tier the loop's own shortest wave, on
// the high tier cascade 1's, the finest cascade whose heights move a crest
// across the caps' soft edge. Cascade 2 holds under a sixth of the sea's
// standard deviation wherever the caps cover a ten-thousandth of it or more,
// and the soft edge absorbs that.
float oceanCrestKeep(float pixel) {
  if (oceanCoast.w > 1.5) return oceanWindPixelKeep(FFT_CASCADE_1, FFT_N, pixel);
  return oceanWindPixelKeep(oceanLoopSize(), LOOP_N, pixel);
}

// The low tier's bump scaled by the wind sea's height here, share its share
// of the fully developed height (oceanWindAmp), which the broken waves and the
// headland's lee cut down. Zero on the other tiers, whose sea carries no bump.
float oceanBumpScale(float share, float breaking, float shelter) {
  return min(oceanWind.x * share * (1.0 - breaking) * shelter / OCEAN_BUMP_HS, OCEAN_BUMP_MAX);
}

// The most of the drawn wind sea's slopes the normal takes, so the variance
// they carry, drawn, is never more than Cox and Munk's whole sea for the wind
// in this shelter: the loop, one bake scaled to every wind, keeps a strong
// wind's steepness in a light one, where a calm sea is glassy.
float oceanWindSlopeLimit(float u10, float shelter, float drawn) {
  return min(1.0, sqrt((WATER_COX_MUNK_A + WATER_COX_MUNK_B * u10) * shelter / max(drawn, 1.0e-6)));
}
#endif
