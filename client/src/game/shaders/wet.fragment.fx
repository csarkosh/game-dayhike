// Wet plugin, fragment definitions: what the water touches is darker and
// glossy below the wet line, and on the medium and low tiers darkened by
// the water above it as well (spec §6). Applied on both UBO paths at
// CUSTOM_FRAGMENT_DEFINITIONS.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The literals mirror wetPlugin.ts and a lockstep test asserts they agree.
const float WET_ALBEDO = 0.4;
const float WET_ROUGHNESS = 0.15;
const float WET_BAND = 0.1;

// 1 below the line, 0 above it, blended over WET_BAND.
float wetBelow(float y, float line) {
  return 1.0 - smoothstep(line - WET_BAND * 0.5, line + WET_BAND * 0.5, y);
}

// 1 inside the body's footprint, 0 from 3 m past its rim, blended from 1 m.
// Both the wet look and the darkening by the water above are held to it.
float wetInside(vec2 xz, vec2 centre, float radius) {
  return 1.0 - smoothstep(radius + 1.0, radius + 3.0, length(xz - centre));
}
