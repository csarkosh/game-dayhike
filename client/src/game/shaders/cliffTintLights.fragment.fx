// Spliced at CUSTOM_FRAGMENT_BEFORE_LIGHTS: half the module's own colour,
// half the ground's under it, so a granite wall and a pale cobble hillside
// read as one material. A black rgb means no tint data.
// COMMENT RULES as in cliffTint.vertex.fx.
#ifdef CLIFFTINT
  float cHas = step(1.0 / 255.0, max(vCliffTint.r, max(vCliffTint.g, vCliffTint.b)));
  surfaceAlbedo = mix(surfaceAlbedo, vCliffTint.rgb, CLIFF_GROUND_TINT * cHas);
#endif
