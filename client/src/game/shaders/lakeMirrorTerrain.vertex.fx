// The lake mirror's ground, vertex stage (lakeMirror.ts): the inner terrain
// rings drawn into the mirror's target in place of the terrain's own
// material, which is far too costly for a second pass. The canopy's density
// rides in terrainWeights2.w, as the rain map's height shader reads it.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.

attribute vec3 position;
attribute vec4 terrainWeights2;
uniform mat4 world;
uniform mat4 viewProjection;
varying float vCanopy;
#ifdef FOG
// The scene's fog, as Babylon's own fog includes reckon it: the distance in
// the view the pass is drawn with, the mirrored camera's.
uniform mat4 view;
varying vec3 vFogDistance;
#endif

void main(void) {
  vec4 worldPos = world * vec4(position, 1.0);
  vCanopy = terrainWeights2.w;
#ifdef FOG
  vFogDistance = (view * worldPos).xyz;
#endif
  gl_Position = viewProjection * worldPos;
}
