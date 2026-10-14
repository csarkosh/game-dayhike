// Foliage diffuse, spliced into the PBR fragment by FoliageLightPlugin at
// CUSTOM_FRAGMENT_DEFINITIONS and called only from the sun's diffuse line: the
// plugin's injected line selects it by the light's directional define, not by
// its index, and the sun is the scene's only directional light. A wrapped
// Lambert that is exactly Lambert at full light and lifted at the terminator
// (the lift stands in for the light that comes through a thin leaf, so a
// card facing the sun is lit as Lambert would light it and a card edge-on
// still takes a share), plus a backlight term that glows when the sun is
// behind the card and the viewer in front, thicker at the root. Both take
// the canopy's cut of the sun: foliageCanopySun's share by the canopy over
// the instance, which the foliage plugin carries as the openness in
// vFoliage.a (1 in the open). The uniform is the material's: the share for a
// material whose meshes receive no cast shadow, zero for one whose meshes
// do, which the cast shadow already cuts. Every other light keeps Babylon's
// own line. The plugin is only attached to materials that also carry the
// foliage plugin, which declares vFoliage and vFoliageH and the uniform under
// its define, so the reads of them are kept under that define too: an effect
// processed without it compiles the function with the cut at 1.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.

const float FOLIAGE_WRAP = 0.35;
const float FOLIAGE_BACK = 0.6;
const float FOLIAGE_BACK_POWER = 4.0;
const float FOLIAGE_PI = 3.14159265;

float foliageWrapLambert(float ndotl, float wrap) {
  return clamp((ndotl + wrap) / (1.0 + wrap), 0.0, 1.0);
}

vec3 foliageDiffuseLighting(preLightingInfo info, vec3 lightColor, float h, vec3 viewDir) {
  float fSun = 1.0;
#ifdef FOLIAGE
  fSun = 1.0 - foliageCanopySun * (1.0 - vFoliage.a);
#endif
  vec3 unit = info.attenuation * lightColor / FOLIAGE_PI;
  vec3 wrapped = unit * foliageWrapLambert(info.NdotLUnclamped, FOLIAGE_WRAP);
  float back = pow(clamp(-dot(viewDir, info.L), 0.0, 1.0), FOLIAGE_BACK_POWER);
  float thickness = 1.0 - 0.7 * h;
  return (wrapped + unit * FOLIAGE_BACK * back * thickness) * fSun;
}
