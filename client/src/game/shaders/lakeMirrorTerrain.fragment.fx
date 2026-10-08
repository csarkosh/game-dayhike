// The lake mirror's ground, fragment stage (lakeMirror.ts): one flat colour,
// the ground's lit base colour the renderer sets each frame the pass runs
// (lakeMirrorColour, linear), darker under the canopy, then fogged as the
// scene's materials are.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The literal below mirrors MIRROR_CANOPY_SHADE in lakeMirror.ts and a
// lockstep test holds them equal.

uniform vec3 lakeMirrorColour;
varying float vCanopy;
#ifdef FOG
uniform vec4 vFogInfos;
uniform vec3 vFogColor;
varying vec3 vFogDistance;
#endif

// How much darker the ground is under a full canopy.
const float LAKE_MIRROR_CANOPY_SHADE = 0.5;

void main(void) {
  vec3 colour = lakeMirrorColour * (1.0 - LAKE_MIRROR_CANOPY_SHADE * vCanopy);
#ifdef FOG
  // The scene's fog is Babylon's squared exponential (lighting.ts), its
  // density in vFogInfos.w. PBR takes the factor to linear space before it
  // mixes, so the ground here fogs as the terrain does in the main view.
  float fogDepth = length(vFogDistance) * vFogInfos.w;
  float fog = pow(clamp(exp(-fogDepth * fogDepth), 0.0, 1.0), 2.2);
  colour = mix(vFogColor, colour, fog);
#endif
  gl_FragColor = vec4(colour, 1.0);
}
