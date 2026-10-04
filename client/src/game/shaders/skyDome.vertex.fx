// The sky dome's vertex stage, built by skyDome.ts. The box rides with the
// eye (infiniteDistance), so a corner's own position is its direction from
// the eye: the fragment stage normalises it.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.

attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vSkyDir;

void main(void) {
  vSkyDir = position;
  gl_Position = viewProjection * world * vec4(position, 1.0);
}
