#ifdef OCEAN
// Water plugin, the sea's swash: spliced into the definitions of both stages
// after the sea's surface (oceanSurface.fx), whose coastline and profile reads
// it takes. Each bore that reaches the cove's face runs up it as a thin sheet
// (swashTable.ts), one column a metre of shore, held in the oceanSwash table:
// a row of SWASH_COLUMNS texels, (front, thickness, wet reach, age) each, the
// front and the reach in metres up the face from the still waterline. The
// vertex stage lifts the sea onto the sheet and the fragment stage's depth
// takes the same lift, so the surface climbs the pebbles as a film.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The literals mirror swashTable.ts and a lockstep test asserts they agree.
// The table is read at level 0, so the read is legal in any control flow.
const float SWASH_COLUMNS = 512.0;
const float SWASH_HALF = 256.0;
const float SWASH_SHEET_MIN = 0.001;

// The texel u of the column nearest world z: the cove's centre (oceanCove.x)
// is column SWASH_HALF, a column a metre, held to the table.
float swashU(float z) {
  return (clamp(z - oceanCove.x + SWASH_HALF, 0.0, SWASH_COLUMNS - 1.0) + 0.5) / SWASH_COLUMNS;
}

// The sheet's thickness (m) at d, metres up the face from the still waterline
// (negative seaward), and world z: the column's thickness at the waterline,
// thinning to nothing at its front, held to it seaward, and none past the
// front or seaward of the face's toe (oceanCove.z).
float swashSheet(float d, float z) {
  vec4 col = textureLod(oceanSwash, vec2(swashU(z), 0.5), 0.0);
  float cover = step(oceanCove.z, d) * step(d, col.x);
  return cover * col.y * clamp(1.0 - d / max(col.x, SWASH_SHEET_MIN), 0.0, 1.0);
}

// The cove's share at world z: 1 across it, 0 past OCEAN_COVE_END beyond
// either end, blended over the ends as the wet ground's is (wet.fragment.fx).
// Here, so both stages have it: the sheet's rest below and the fragment
// stage's bed (waterLights.fragment.fx) both take it.
const float OCEAN_COVE_END = 30.0;
float oceanCoveShare(float z) {
  return 1.0 - smoothstep(oceanCove.y - OCEAN_COVE_END, oceanCove.y + OCEAN_COVE_END, abs(z - oceanCove.x));
}

// How far the sheet lifts the sea at the undisplaced point p over ground h
// metres below the level (the profile's depth, negative above it), with the
// swell's height swell already on the surface: to the sheet's top where the
// sheet stands higher than the still sea, and up the face within the cove
// to the ground itself wherever the surface would lie under it, so the sea
// hugs the pebbles between sheets and the fragment stage's depth, 0 there,
// discards it. Never cuts the sea.
float swashLift(vec2 p, float h, float swell) {
  float phaseDz;
  float sheet = swashSheet(p.x - oceanCoastAt(p.y, phaseDz).x, p.y);
  float lift = max(0.0, sheet - h) * step(SWASH_SHEET_MIN, sheet);
  float rest = max(0.0, -(h + swell)) * oceanCoveShare(p.y);
  return max(lift, rest);
}

// The profile's depth at p as the swell's sum blends it (its h): the bay's
// and the cove's rows by the cove's weight along the coast. For the vertex
// stage, which has no foam to read it from.
float swashDepth(vec2 p) {
  float phaseDz;
  vec4 coast = oceanCoastAt(p.y, phaseDz);
  float column = (p.x - coast.x - OCEAN_D_MIN) / OCEAN_D_STEP;
  float bay = oceanAtlasRead(OCEAN_ROW_BAY_PROFILE, column).x;
  return bay + (oceanAtlasRead(OCEAN_ROW_COVE_PROFILE, column).x - bay) * coast.z;
}
#endif
