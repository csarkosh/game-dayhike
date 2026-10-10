#ifdef OCEAN_LIP
// The strip's vertex (oceanLip.ts), in place of the rings' displacement on
// the strip's material: its position carries the column's world z, the slot
// and the section's vertex, not a place, and oceanLipPlace makes the place
// from them, the sea's surface there and the crest the tracker found. The
// swell goes on to the fragment stage as the rings hand it on, so the sea's
// shading draws the strip unchanged.
vec2 oceanLipXZ;
vec4 oceanLipSwell;
vec4 oceanLipEnv;
positionUpdated = oceanLipPlace(positionUpdated, oceanLipXZ, oceanLipSwell, oceanLipEnv);
vOceanXZ = oceanLipXZ;
vOceanSwellA = oceanLipSwell;
vOceanSwellB = oceanLipEnv;
#endif
