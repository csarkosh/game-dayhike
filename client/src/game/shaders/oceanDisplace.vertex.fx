#ifdef OCEAN
// The sea's rings carry world positions and no transform, so the position
// here, before the waves move it, is the world's.
// A vertex in a ring's outer band first slides toward the coarser ring's
// lattice, by the band's weight (oceanMorph) along the half-edge to it
// (oceanCoarse): at the ring's edge the weight is whole and the vertex lies
// on a vertex of the coarser ring, which evaluates the same point, so no
// border cracks. The sea is evaluated once, at that point, which is the point
// the fragment stage shades. The ring's normal stays up: the sea's normal is
// made per pixel.
positionUpdated.xz -= oceanMorph * oceanCoarse;
vOceanXZ = positionUpdated.xz;
positionUpdated += oceanDisplace(positionUpdated.xz);
#endif
