// The lake's ripples as two states, spliced into the water plugin's fragment
// definitions after water.fragment.fx: the cat's-paw mask that switches the
// surface between glass and the rippled octaves, and the rain's rings near
// the eye, then the lake's second octave. Every function but the octave,
// which samples PBR's bump, is a pure function of its arguments with a twin
// of the same name in lakeRipples.ts, and every constant mirrors
// lakeRipples.ts or windParams.ts, which a lockstep test holds equal.
// Branches are chosen by step, mix, clamp and smoothstep, never by a test on
// a varying.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
const float PAW_FEATURE_M = 10.0;
const float PAW_SPEED = 1.5;
const float PAW_EDGE_M = 0.5;
const float PAW_LIFE_S = 6.0;
const float PAW_GUST_FLOOR = 0.5;
// The paws' threshold at cover 0, 1/8, 2/8 and on to 1, measured so the
// paws cover about the cover under the real gusts (PAW_COVER_TABLE).
const float PAW_COVER_0 = 1.0;
const float PAW_COVER_1 = 0.521;
const float PAW_COVER_2 = 0.404;
const float PAW_COVER_3 = 0.343;
const float PAW_COVER_4 = 0.294;
const float PAW_COVER_5 = 0.246;
const float PAW_COVER_6 = 0.198;
const float PAW_COVER_7 = 0.144;
const float PAW_COVER_8 = 0.0;
const float LAKE_RING_REACH = 8.0;
const float LAKE_RING_FADE_M = 2.0;
const float LAKE_RING_CELL = 0.18;
const float LAKE_RING_SPEED = 0.18;
const float LAKE_RING_LAMBDA = 0.03;
const float LAKE_RING_TAU = 0.3;
const float LAKE_RING_AMP = 0.004;
const float LAKE_RINGS_0 = 35.0;
const float LAKE_RINGS_1 = 77.0;
const float LAKE_RINGS_2 = 150.0;
const float LAKE_RAIN_MM_H = 4.0;
const float LAKE_RING_FOLD = 512.0;
const float LAKE_WIND_TURN = 0.005235987755982988;
// The wind's, from windParams.ts: the time's wrap and the gust's two waves.
const float LAKE_TIME_WRAP = 300.0;
const float LAKE_WIND_K1 = 0.25132741228718347;
const float LAKE_WIND_K2 = 0.6981317007977318;
const float LAKE_WIND_OMEGA1 = 0.3769911184;
const float LAKE_WIND_OMEGA2 = 0.879645943;
const float LAKE_WIND_RAGGED = 1.2;
const float LAKE_WIND_RAGGED_CELL = 6.0;

// The wind's gust at p at the wind's time t, the wind blowing along dir:
// foliageGust's closed form (foliage.vertex.fx), the trees' own gusts.
float lakeGust(vec2 p, float t, vec2 dir) {
  float u = dir.x * p.x + dir.y * p.y;
  vec2 c = floor(p / LAKE_WIND_RAGGED_CELL);
  float ragged = LAKE_WIND_RAGGED * (fract(c.x * 0.618034 + c.y * 0.381966) - 0.5);
  return sin(LAKE_WIND_K1 * u - LAKE_WIND_OMEGA1 * t + ragged) + 0.5 * sin(LAKE_WIND_K2 * u - LAKE_WIND_OMEGA2 * t + 1.7 * ragged);
}

// Hoskins' hash without sine of (i, s, i + s), 0 to 1: midgeHash's.
float lakeHash(float i, float s) {
  vec3 p = fract(vec3(i, s, i + s) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

// How far the paws have drifted over the last span seconds (negative: the
// next), at PAW_SPEED along a wind that turns at LAKE_WIND_TURN and blows
// along dir now: the drift's integral in closed form.
vec2 lakePawDrift(vec2 dir, float span) {
  float c = cos(LAKE_WIND_TURN * span);
  float s = sin(LAKE_WIND_TURN * span);
  float k = PAW_SPEED / LAKE_WIND_TURN;
  return k * vec2(dir.y * (1.0 - c) + dir.x * s, dir.x * (c - 1.0) + dir.y * s);
}

// A lattice node's value at time t: it rises and falls over PAW_LIFE_S from
// a phase its hash sets.
float lakePawNode(vec2 c, float t) {
  return 0.5 - 0.5 * cos(6.283185307179586 * (t / PAW_LIFE_S + lakeHash(c.x, c.y)));
}

// Value noise of the living nodes at p, in lattice units: the value, then its
// gradient per lattice unit.
vec3 lakePawNoise(vec2 p, float t) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = lakePawNode(i, t);
  float b = lakePawNode(i + vec2(1.0, 0.0), t);
  float c = lakePawNode(i + vec2(0.0, 1.0), t);
  float d = lakePawNode(i + vec2(1.0, 1.0), t);
  float k = a - b - c + d;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y, du.x * (b - a + k * u.y), du.y * (c - a + k * u.x));
}

// The paws' field, 0 to 1, then its gradient per metre, drifted by span seconds.
vec3 lakePawField(vec2 xz, float t, vec2 dir, float span) {
  vec2 p = (xz - lakePawDrift(dir, span)) / PAW_FEATURE_M;
  vec3 a = lakePawNoise(p, t);
  vec3 b = lakePawNoise(2.0 * p + vec2(37.0, 17.0), t);
  return vec3(a.x * 2.0 / 3.0 + b.x / 3.0, (a.yz * 2.0 / 3.0 + b.yz * 2.0 / 3.0) / PAW_FEATURE_M);
}

// The paws' threshold at a cover, 0 to 1: the table's knots, linear between,
// summed as ramps so no knot is chosen by a test.
float lakePawThreshold(float cover) {
  float c = 8.0 * clamp(cover, 0.0, 1.0);
  return PAW_COVER_0
    + (PAW_COVER_1 - PAW_COVER_0) * clamp(c, 0.0, 1.0)
    + (PAW_COVER_2 - PAW_COVER_1) * clamp(c - 1.0, 0.0, 1.0)
    + (PAW_COVER_3 - PAW_COVER_2) * clamp(c - 2.0, 0.0, 1.0)
    + (PAW_COVER_4 - PAW_COVER_3) * clamp(c - 3.0, 0.0, 1.0)
    + (PAW_COVER_5 - PAW_COVER_4) * clamp(c - 4.0, 0.0, 1.0)
    + (PAW_COVER_6 - PAW_COVER_5) * clamp(c - 5.0, 0.0, 1.0)
    + (PAW_COVER_7 - PAW_COVER_6) * clamp(c - 6.0, 0.0, 1.0)
    + (PAW_COVER_8 - PAW_COVER_7) * clamp(c - 7.0, 0.0, 1.0);
}

// The cat's-paw mask at xz, 0 on glass to 1 in a paw: the field raised where
// the gust blows, thresholded at lakePawThreshold(cover), so the paws cover
// about the cover, with an edge PAW_EDGE_M metres wide along the field's own
// gradient. Over the wrap's last life the drift crosses to the next wrap's,
// so the pattern runs on through it. The next wrap's field is read only in
// those last six seconds, the one span where its blend is above 0: t is the
// lake's time, a uniform, so the branch is the same for every pixel.
float lakePaw(vec2 xz, float t, vec2 windDir, float cover, float gust) {
  vec3 f = lakePawField(xz, t, windDir, t);
  if (t > LAKE_TIME_WRAP - PAW_LIFE_S) {
    vec3 b = lakePawField(xz, t, windDir, t - LAKE_TIME_WRAP);
    f = mix(f, b, smoothstep(LAKE_TIME_WRAP - PAW_LIFE_S, LAKE_TIME_WRAP, t));
  }
  float g = PAW_GUST_FLOOR + (1.0 - PAW_GUST_FLOOR) * clamp(gust, 0.0, 1.0);
  f *= g;
  float slope = max(length(f.yz), 1.0e-4);
  return clamp((f.x - lakePawThreshold(cover)) / (slope * PAW_EDGE_M), 0.0, 1.0);
}

// The octaves' amplitude under the mask: 1 in a paw, 0 on glass, smooth over the edge.
float octaveAmplitude(float paw) {
  return smoothstep(0.0, 1.0, paw);
}

// Live rings a square metre at the weather's rain, LAKE_RAIN_MM_H mm/h at 1:
// LAKE_RINGS_0 at 0.5 mm/h, LAKE_RINGS_1 at 1 and LAKE_RINGS_2 from 2, linear between.
float lakeLiveRings(float rate) {
  float mmh = LAKE_RAIN_MM_H * rate;
  return LAKE_RINGS_0 * clamp(mmh / 0.5, 0.0, 1.0) + (LAKE_RINGS_1 - LAKE_RINGS_0) * clamp((mmh - 0.5) / 0.5, 0.0, 1.0) + (LAKE_RINGS_2 - LAKE_RINGS_1) * clamp(mmh - 1.0, 0.0, 1.0);
}

// One ring's height's derivative along r, r metres from its drop and age
// seconds after it: a train behind a front at LAKE_RING_SPEED times age.
float lakeRingDh(float r, float age) {
  float k = 6.283185307179586 / LAKE_RING_LAMBDA;
  float phase = k * (r - LAKE_RING_SPEED * age);
  float s = clamp((LAKE_RING_SPEED * age - r) / LAKE_RING_LAMBDA, 0.0, 1.0);
  float window = s * s * (3.0 - 2.0 * s);
  float windowDr = -6.0 * s * (1.0 - s) / LAKE_RING_LAMBDA;
  return LAKE_RING_AMP * exp(-age / LAKE_RING_TAU) * (k * cos(phase) * window + sin(phase) * windowDr);
}

// splashHash's (rainSplash.ts), Hoskins' sine-free hash22: two values in 0 to 1.
vec2 lakeRingHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// The rain's rings at xz at the lake's time t, dist metres from the eye: the
// tilt they give the normal, minus the height's gradient. One drop a cell a
// second at the cell's own phase, its point in the cell hashed anew each
// second, the three by three cells about the point summed (a ring dies before
// it leaves them), scaled by the live rings the rain gives and faded out over
// the last LAKE_RING_FADE_M before LAKE_RING_REACH.
vec2 lakeRainSlope(vec2 xz, float t, float rate, float dist) {
  vec2 base = floor(xz / LAKE_RING_CELL);
  vec2 sum = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cell = base + vec2(float(i), float(j));
      vec2 h = mod(cell, LAKE_RING_FOLD);
      float s = t + lakeRingHash(h).x;
      float age = fract(s);
      float cycle = mod(floor(s), LAKE_TIME_WRAP);
      vec2 d = xz - (cell + lakeRingHash(h + cycle)) * LAKE_RING_CELL;
      float r = length(d);
      sum -= d * (lakeRingDh(r, age) / max(r, 1.0e-5));
    }
  }
  float scale = min(lakeLiveRings(rate) / LAKE_RINGS_1, 1.0) * (1.0 - smoothstep(LAKE_RING_REACH - LAKE_RING_FADE_M, LAKE_RING_REACH, dist));
  return sum * scale;
}

// The lake's second octave: the bump's slope at a finer tile, its constants
// water.fragment.fx's (WATER_OCTAVE2_TILE, _WEIGHT and _DRIFT). The sample
// runs upwind of the pixel, so the pattern travels downwind with the paws,
// at the tile times the drift, metres a second, at full wind. The sea never
// draws it. Returns an xz slope to add to the normal.
vec2 lakeRipple2(vec2 xz) {
  vec2 uv = xz / WATER_OCTAVE2_TILE - waterWindTime * WATER_OCTAVE2_DRIFT;
#ifdef BUMP
  vec3 n = texture2D(bumpSampler, uv).xyz * 2.0 - 1.0;
  return n.xy * WATER_OCTAVE2_WEIGHT;
#else
  return vec2(0.0);
#endif
}
