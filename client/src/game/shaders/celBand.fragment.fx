// Cel-spike band function, spliced into the PBR fragment
// by CelShadingPlugin in cel.ts. Plugin custom code is applied AFTER the
// engine's string preprocessing of the base shader, so nothing in this file
// may rely on material conditionals: the gate is the celOn uniform, declared
// by the plugin's getUniforms and bound per submesh.
//
// COMMENT RULES, hard-won in etchedOutline.fragment.fx: never put a
// semicolon inside a trailing comment on a declaration line, and never spell
// a hashed preprocessor keyword in comment prose.
//
// The numeric literals below mirror celBandCurve in stylizeParams.ts and a
// lockstep test asserts they agree. Tune them there and here together.

// Retuned 2026-08-29: two hard plates instead of three soft ones. CEL_SOFTNESS
// also sets the band edge's anti-aliasing width - lower risks shimmer.
const float CEL_BANDS = 2.0;
const float CEL_SOFTNESS = 0.05;
const float CEL_STRENGTH = 1.0;
const float CEL_ZERO_GUARD = 0.08;

// Bands the intensity of the direct-diffuse accumulator, preserving hue
// ratios so the sun's colour survives. Folded domain t = l/(1+l) keeps HDR
// sunlight from blowing out the top band. Quantize to band centres with a
// soft rise near each band's top edge (no rise past the top band, which
// caps the target strictly below 1), blend by CEL_STRENGTH, kill true
// darkness with the zero guard, unfold. celOn below 0.5 is a pass-through.
vec3 celBand(vec3 diffuse, float celOn) {
  if (celOn < 0.5) {
    return diffuse;
  }
  float l = max(diffuse.r, max(diffuse.g, diffuse.b));
  if (l <= 0.0) {
    return diffuse;
  }
  float t = l / (1.0 + l);
  float i = floor(t * CEL_BANDS);
  float f = t * CEL_BANDS - i;
  float rise = i < CEL_BANDS - 1.0 ? smoothstep(1.0 - CEL_SOFTNESS, 1.0, f) : 0.0;
  float q = (i + 0.5 + rise) / CEL_BANDS;
  float guard = smoothstep(0.0, CEL_ZERO_GUARD, t);
  float tq = min(0.98, mix(t, q, CEL_STRENGTH) * guard);
  float lb = tq / (1.0 - tq);
  return diffuse * (lb / l);
}
