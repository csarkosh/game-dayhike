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
#endif
