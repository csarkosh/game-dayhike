// Foliage diffuse, spliced into the PBR fragment by FoliageLightPlugin at
// CUSTOM_FRAGMENT_DEFINITIONS and called from every per-light diffuse line
// with that light's index. Only the sun (index 0) is changed: an energy-
// conserving wrap Lambert plus a backlight term that glows when the light is
// behind the card and the viewer in front, thicker at the root. Other lights
// return Babylon's own result untouched. The plugin is only attached to
// materials that also carry the foliage plugin, which declares vFoliageH.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.

const float FOLIAGE_WRAP = 0.35;
const float FOLIAGE_BACK = 0.6;
const float FOLIAGE_BACK_POWER = 4.0;
const float FOLIAGE_PI = 3.14159265;

float foliageWrapLambert(float ndotl, float wrap) {
  return clamp((ndotl + wrap) / ((1.0 + wrap) * (1.0 + wrap)), 0.0, 1.0);
}

vec3 foliageDiffuseLighting(preLightingInfo info, vec3 lightColor, float lightIndex, float h, vec3 viewDir) {
  if (lightIndex > 0.5) {
    return computeDiffuseLighting(info, lightColor);
  }
  vec3 unit = info.attenuation * lightColor / FOLIAGE_PI;
  vec3 wrapped = unit * foliageWrapLambert(info.NdotLUnclamped, FOLIAGE_WRAP);
  float back = pow(clamp(-dot(viewDir, info.L), 0.0, 1.0), FOLIAGE_BACK_POWER);
  float thickness = 1.0 - 0.7 * h;
  return wrapped + unit * FOLIAGE_BACK * back * thickness;
}
