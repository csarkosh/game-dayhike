// The game's shell on Babylon.js 9.18.0: RAIN_HEIGHT_VERTEX (rainMap.ts)

attribute vec3 position;
#ifdef RAIN_HEIGHT_TERRAIN
attribute vec4 terrainWeights2;
varying float vCanopy;
#endif
#include<instancesDeclaration>
uniform mat4 viewProjection;
varying float vHeight;
void main(void) {
#include<instancesVertex>
  vec4 worldPos = finalWorld * vec4(position, 1.0);
  vHeight = worldPos.y;
#ifdef RAIN_HEIGHT_TERRAIN
  vCanopy = terrainWeights2.w;
#endif
  gl_Position = viewProjection * worldPos;
}
