// Wet plugin, the weather's wetting: Lagarde's porosity rule, applied at
// CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS, inside the metallic workflow's
// reflectivity block, where metallicRoughness.g is the material's final
// roughness (its map, detail and microsurface map applied) and
// surfaceAlbedo is the base colour the block copies out next. A porous
// surface (rough, above 0.5) darkens to a fifth and glosses by half of
// that at full wetness, a polished one does not change, and each material
// caps its porosity: bark soaks, a leaf glazes. wetWeather is the weather's
// wetness, bound once a frame for every material.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
{
  float wetPorosity = min(wetCap, clamp((metallicRoughness.g - 0.5) / 0.4, 0.0, 1.0));
  float wetFactor = mix(1.0, 0.2, wetPorosity);
  surfaceAlbedo *= mix(1.0, wetFactor, wetWeather);
  float wetGloss = mix(1.0, 1.0 - metallicRoughness.g, mix(1.0, wetFactor, 0.5 * wetWeather));
  metallicRoughness.g = 1.0 - wetGloss;
}
