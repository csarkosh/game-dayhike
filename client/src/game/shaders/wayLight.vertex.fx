// The way down's mist, built by wayLight.ts: the channel of pale ground mist
// the chase shows a player, drawn as sheets over the ground, veils along the
// way and fins across it. One mesh a stretch of way, in world space already.
// Each vertex carries, as wayLightGeometry.ts sets them: its metres from the
// way's line, its metres over the ground, its kind (0 a sheet, 1 a veil, 2 a
// fin) and the metres the mist stands to where it is. The fragment stage
// does the rest, since the mist is shaped by where each fragment is in the
// world.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.

attribute vec3 position;
attribute vec4 wayLight;
uniform mat4 viewProjection;

varying vec3 vPlace;
varying vec4 vWay;

void main(void) {
  vPlace = position;
  vWay = wayLight;
  gl_Position = viewProjection * vec4(position, 1.0);
}
