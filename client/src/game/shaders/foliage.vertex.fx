// Foliage vertex definitions, spliced by FoliagePlugin (foliagePlugin.ts) at
// CUSTOM_VERTEX_DEFINITIONS. The record uniforms are declared by the plugin
// before this text (the declaration include precedes the custom definitions
// in Babylon's PBR vertex source), so the function below may read windDir.
// Every constant mirrors windParams.ts and a lockstep test asserts they agree.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.
#ifdef FOLIAGE
#ifdef FOLIAGE_TINT
#ifdef THIN_INSTANCES
attribute vec4 foliage;
#endif
#endif
varying vec4 vFoliage;
varying float vFoliageH;
varying float vFoliageClump;
varying float vFoliageDist;

const float WIND_K1 = 0.25132741228718347;
const float WIND_K2 = 0.6981317007977318;
const float WIND_OMEGA1 = 0.3769911184;
const float WIND_OMEGA2 = 0.879645943;
const float WIND_OMEGA3 = 12.5663706144;
const float WIND_RAGGED = 1.2;
const float WIND_RAGGED_CELL = 6.0;
const float FOLIAGE_CLUMP_CELL = 1.5;

// Mirrors gustAt in windParams.ts: two octaves whose phase is the position
// projected onto the wind direction, plus a lattice hash so the front is
// ragged rather than a stripe.
float foliageGust(vec2 p, float t) {
  float u = windDir.x * p.x + windDir.y * p.y;
  vec2 c = floor(p / WIND_RAGGED_CELL);
  float ragged = WIND_RAGGED * (fract(c.x * 0.618034 + c.y * 0.381966) - 0.5);
  return sin(WIND_K1 * u - WIND_OMEGA1 * t + ragged) + 0.5 * sin(WIND_K2 * u - WIND_OMEGA2 * t + 1.7 * ragged);
}
#endif
