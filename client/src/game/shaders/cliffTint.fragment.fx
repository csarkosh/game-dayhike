// Cliff tint fragment definitions, spliced at CUSTOM_FRAGMENT_DEFINITIONS.
// CLIFF_GROUND_TINT mirrors cliffTintPlugin.ts and a lockstep test asserts
// they agree.
// COMMENT RULES as in cliffTint.vertex.fx.
#ifdef CLIFFTINT
varying vec4 vCliffTint;
const float CLIFF_GROUND_TINT = 0.5;
#endif
