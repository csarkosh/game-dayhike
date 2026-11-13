// The way down's light, built by wayLight.ts: the half pipe the chase shows a
// player, a floor of faint cold light and a wall of lit mist either side of
// it. One mesh a stretch of way, in world space already. Each vertex carries
// how much of its kind's light it holds (its profile, 0 to 1) and its kind
// (0 the floor, 1 a wall), which wayLightGeometry.ts sets.
//
// The light a vertex gives is its profile times its kind's strength, falling
// off with the metres from the eye at its kind's reach, times the frame's
// gain: the level the chase has brought the light to, and on the post path
// the frame's dim taken back out, so the way is as bright as it was made
// while the woods round it darken. A gain of nothing draws nothing.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.

attribute vec3 position;
attribute vec2 wayLight;
uniform mat4 viewProjection;
uniform vec3 wayEye;
uniform float wayGain;
uniform vec4 wayShape;

varying float vAmount;

void main(void) {
  float strength = mix(wayShape.x, wayShape.y, wayLight.y);
  float reach = mix(wayShape.z, wayShape.w, wayLight.y);
  vAmount = wayLight.x * strength * exp(-reach * distance(position, wayEye)) * wayGain;
  gl_Position = viewProjection * vec4(position, 1.0);
}
