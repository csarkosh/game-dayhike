// Spliced at CUSTOM_VERTEX_UPDATE_WORLDPOS. The default first, overwritten
// only where the attribute actually exists: the fragment stage treats a
// black rgb as no tint data and leaves the albedo alone.
// COMMENT RULES as in cliffTint.vertex.fx.
#ifdef CLIFFTINT
  vCliffTint = vec4(0.0, 0.0, 0.0, 1.0);
#ifdef THIN_INSTANCES
  vCliffTint = foliage;
#endif
#endif
