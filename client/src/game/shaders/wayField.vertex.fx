// The mist beyond the way's banks, built by wayMistField.ts: sheets over the
// ground round the eye and fins standing in a lattice, on the tiers with no
// marched ground mist. One mesh, in world space already. Each vertex carries,
// as wayMistFieldGeometry.ts sets them: its metres from the way's line (under
// nothing where its ground is not yet known), its metres over the ground, its
// kind (0 a sheet, 1 a fin) and the metres a fin's mist stands to.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.

attribute vec3 position;
attribute vec4 wayField;
uniform mat4 viewProjection;

varying vec3 vPlace;
varying vec4 vField;

void main(void) {
  vPlace = position;
  vField = wayField;
  gl_Position = viewProjection * vec4(position, 1.0);
}
