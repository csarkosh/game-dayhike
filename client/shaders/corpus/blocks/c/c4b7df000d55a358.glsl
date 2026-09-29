// Cliff tint fragment definitions, spliced at CUSTOM_FRAGMENT_DEFINITIONS.
// CLIFF_GROUND_TINT mirrors cliffTintPlugin.ts and a lockstep test asserts
// they agree.
// COMMENT RULES as in cliffTint.vertex.fx.
layout(location = 14)  in vec4 vCliffTint;
const float CLIFF_GROUND_TINT = 0.5;
#define CUSTOM_FRAGMENT_DEFINITIONS
struct albedoOpacityOutParams
{vec3 surfaceAlbedo;
float alpha;
};