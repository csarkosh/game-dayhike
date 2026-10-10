#ifdef OCEAN
// The sea's rings carry world positions and no transform, so the position
// here, before the waves move it, is the world's.
// A vertex in a ring's outer band first slides toward the coarser ring's
// lattice, by the band's weight (oceanMorph) along the half-edge to it
// (oceanCoarse): at the ring's edge the weight is whole and the vertex lies
// on a vertex of the coarser ring, which evaluates the same point, so no
// border cracks. The sea is evaluated once, at that point, which is the point
// the fragment stage shades, and the swell's sum goes on to it, so it sums no
// swell of its own. The ring's normal stays up: the sea's normal is made per
// pixel, from the swell's interpolated here and the wind sea's.
positionUpdated.xz -= oceanMorph * oceanCoarse;
vOceanXZ = positionUpdated.xz;
vec4 oceanVertexSwell;
vec2 oceanVertexEnv;
vec3 oceanVertexDisplace = oceanDisplace(positionUpdated.xz, oceanVertexSwell, oceanVertexEnv);
positionUpdated += oceanVertexDisplace;
vOceanSwellA = oceanVertexSwell;
vOceanSwellB = vec4(oceanVertexEnv, length(oceanVertexEnv), 0.0);
// Up the cove's face the swash's sheet lifts the sea onto the pebbles
// (oceanSwash.fx), from where the waves were evaluated, and between sheets
// the sea rests on them, the swell's height already on it.
positionUpdated.y += swashLift(vOceanXZ, swashDepth(vOceanXZ), oceanVertexDisplace.y);
#endif
