// The crowd's cards, built by crowdCards.ts: a flat figure for each shade of
// the crowd at the middle distance, drawn into the shade mask alone. One
// mesh, a quad a figure. Each vertex is at its figure's feet in the world and
// carries its corner of the card (x: -1 to 1 across, y: 0 to 1 up), the
// figure's height in metres and how much of it is in the mask. The card is
// half as wide as it is tall (crowdCards.ts CROWD_CARD_WIDE) and stands
// upright, turned about the vertical to face the camera.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.

attribute vec3 position;
attribute vec4 crowdCard;
attribute vec2 crowdStir;
uniform mat4 view;
uniform mat4 viewProjection;

varying vec4 vCard;
varying vec2 vStir;

void main(void) {
  // The camera's right in the world, laid flat.
  vec2 right = vec2(view[0][0], view[2][0]);
  right /= max(length(right), 0.0001);
  vec3 at = position;
  at.xz += right * (crowdCard.x * crowdCard.z * 0.25);
  at.y += crowdCard.y * crowdCard.z;
  vCard = crowdCard;
  vStir = crowdStir;
  gl_Position = viewProjection * vec4(at, 1.0);
}
