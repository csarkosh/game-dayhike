// Deadwood plugin, fragment definitions: the varying, the moss map's sampler,
// and the constants, every one mirrored in deadwoodParams.ts or mossParams.ts
// (a lockstep test holds them equal).
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
#ifdef DEADWOOD
varying vec4 vDeadwood;
uniform sampler2D mossSampler;
const vec3 MOSS_SIDE = vec3(-0.5486, 0.2494, 0.798);
const float MOSS_SIDE_EDGE = 0.6;
const vec2 MOSS_BAND = vec2(1.0, 2.5);
const vec2 MOSS_AMOUNT = vec2(0.25, 1.0);
const vec2 MOSS_EDGE = vec2(0.35, 0.65);
const float MOSS_TILE = 3.0;
const vec3 MOSS_TINT = vec3(0.4, 0.47, 0.35);
const float MOSS_ROUGHNESS = 0.95;
const vec3 MOSS_LUMA = vec3(0.2126, 0.7152, 0.0722);
const vec2 DEADWOOD_UP = vec2(-0.1, 0.55);
const float DEADWOOD_LOG_DRAW = 0.7;
const float DEADWOOD_CONTACT = 0.55;
const vec2 DEADWOOD_CONTACT_BAND = vec2(-0.35, 0.15);
#endif
