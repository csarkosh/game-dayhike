// The moss varying, written at CUSTOM_VERTEX_MAIN_END, where the vertex is
// placed and nothing moves it further: the vertex's height above the tree's
// foot in the model's own metres (positionUpdated is the model position,
// whose origin every tree model puts at its footprint base, so no instance
// scale divides it), and the tree's draw, hashed from its foot in world
// space, the translation column of finalWorld (the thin instance's own
// matrix where there are instances, the mesh's world matrix where not, as
// under the billboards' bake).
//
// COMMENT RULES as in moss.vertex.fx.
#ifdef MOSS
vMoss = vec2(positionUpdated.y, mossHash(finalWorld[3].xz));
#endif
