// The crowd's cards, built by crowdCards.ts: the figure's shape, written into
// the shade mask's red as a shade is (shadeSilhouette.ts), which the grade or
// the veil then blurs into a darkness in the mist. The shape is drawn here,
// in shares of the figure's height: a torso broader at the shoulders, a head,
// long arms, legs, and the antlers, the same on both sides of its middle. It
// leans a little on a slow beat of its own (vStir: its phase and its rate),
// and its feet are lost in the mist.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.

uniform float crowdTime;

varying vec4 vCard;
varying vec2 vStir;

float limb(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

void main(void) {
  vec2 p = vec2(vCard.x * 0.25, vCard.y);
  p.x -= sin(crowdTime * vStir.y + vStir.x) * 0.012 * p.y;
  vec2 q = vec2(abs(p.x), p.y);
  float d = limb(q, vec2(0.0, 0.44), vec2(0.0, 0.66)) - mix(0.07, 0.1, smoothstep(0.44, 0.66, q.y));
  d = min(d, length(q - vec2(0.0, 0.755)) - 0.05);
  d = min(d, limb(q, vec2(0.045, 0.44), vec2(0.06, 0.0)) - 0.034);
  d = min(d, limb(q, vec2(0.105, 0.64), vec2(0.135, 0.33)) - 0.024);
  d = min(d, limb(q, vec2(0.03, 0.79), vec2(0.085, 0.9)) - 0.011);
  d = min(d, limb(q, vec2(0.085, 0.9), vec2(0.07, 0.985)) - 0.008);
  d = min(d, limb(q, vec2(0.06, 0.85), vec2(0.125, 0.92)) - 0.008);
  float body = 1.0 - smoothstep(-0.01, 0.03, d);
  float feet = smoothstep(0.0, 0.14, p.y);
  gl_FragColor = vec4(1.0, 0.0, 0.0, body * feet * vCard.w);
}
