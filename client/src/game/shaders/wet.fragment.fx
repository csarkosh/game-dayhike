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

// The cove's swash (wetPlugin.ts, swashTable.ts): inside the cove the ground
// is wet up to the line each column's sheet last climbed to, and dries after
// it. wetCove is (z0, halfWidth, toeD, faceGrade), wetSwash the table's
// (reach, age) two columns a vec4: the reach in metres up the face from the
// still waterline, the age in seconds since a sheet last covered the column.
// The literals mirror wetPlugin.ts and a lockstep test asserts they agree.
const float WET_DAMP_ALBEDO = 0.7;
const float WET_DAMP_ROUGHNESS = 0.5;
const float WET_DRY_S = 60.0;
const float WET_SOAKED_S = 0.5;
const float WET_SPECKLE = 0.2;
const float WET_SPECKLE_S = 10.0;
const float WET_SPECKLE_CELL = 0.05;
const float WET_SPECKLE_COVER = 0.25;
const float WET_SPECKLE_NEAR = 10.0;
const float WET_SPECKLE_FAR = 25.0;
const float WET_COVE_END = 30.0;
const float WET_SWASH_COLUMNS = 512.0;
const float WET_SWASH_HALF = 256.0;

// The cove's share at world z: 1 across it, 0 past WET_COVE_END beyond
// either end, blended over the ends as the ground is, so the bays keep the
// still line alone and no seam shows where the pebbles meet the sand.
float wetCoveShare(float z) {
  return 1.0 - smoothstep(wetCove.y - WET_COVE_END, wetCove.y + WET_COVE_END, abs(z - wetCove.x));
}

// The table's column nearest world z, as the sea reads its own (oceanSwash.fx):
// its reach and its age, from the pair of columns its vec4 holds, the half
// picked by the column's parity.
vec2 wetSwashAt(float z) {
  float c = floor(clamp(z - wetCove.x + WET_SWASH_HALF, 0.0, WET_SWASH_COLUMNS - 1.0) + 0.5);
  vec4 pair = wetSwash[int(c * 0.5)];
  return mix(pair.xy, pair.zw, mod(c, 2.0));
}

// The cove's wetting at a point: how soaked, how damp, and the speckle's
// weight. Below the face's height at the column's reach (wetLevel plus the
// reach times the grade), soaked for WET_SOAKED_S after a sheet, damp by a
// third of WET_DRY_S, dry by WET_DRY_S, and above the still sea a speckle of
// foam fading over WET_SPECKLE_S. All 0 outside the cove.
vec3 wetShore(vec2 xz, float y) {
  vec2 col = wetSwashAt(xz.y);
  float band = wetBelow(y, wetLevel + col.x * wetCove.w) * wetCoveShare(xz.y);
  float soaked = 1.0 - smoothstep(WET_SOAKED_S, WET_DRY_S / 3.0, col.y);
  float damp = smoothstep(WET_SOAKED_S, WET_DRY_S / 3.0, col.y) - smoothstep(WET_DRY_S / 3.0, WET_DRY_S, col.y);
  float fresh = clamp(1.0 - col.y / WET_SPECKLE_S, 0.0, 1.0);
  float above = 1.0 - wetBelow(y, wetLevel);
  return vec3(soaked, damp, WET_SPECKLE * fresh * above) * band;
}

// The speckle's foam: WET_SPECKLE_COVER of the WET_SPECKLE_CELL cells carry
// it, faded to that share as the point's distance from the eye (far) runs
// from WET_SPECKLE_NEAR to WET_SPECKLE_FAR metres, where the cells fall under
// a pixel. The hash is the water's skin's, without sine, which loses
// precision at world coordinates.
float wetSpeckle(vec2 xz, float far) {
  vec3 p3 = fract(vec3(floor(xz / WET_SPECKLE_CELL).xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  float on = step(1.0 - WET_SPECKLE_COVER, fract((p3.x + p3.y) * p3.z));
  return mix(on, WET_SPECKLE_COVER, smoothstep(WET_SPECKLE_NEAR, WET_SPECKLE_FAR, far));
}
