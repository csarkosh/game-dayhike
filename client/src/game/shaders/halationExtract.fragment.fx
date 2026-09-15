// Halation extract: quarter-resolution first stage of the halation chain in
// post.ts, run on the EXPOSED linear scene before the grade pass's tone map.
// Keeps only what is brighter than HALATION_THRESHOLD in exposed linear
// luminance — brighter than display white before the tone map rolls it off —
// tinted toward the red-orange bleed film shows around lights. The response
// saturates at HALATION_CAP over threshold so a very bright source (a raw
// linear luma that can run into the hundreds) cannot blow the half-float
// render target to Inf, which the blur would then spread into solid white.
// The two BlurPostProcess stages that follow are Babylon's own.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose. The literals mirror
// postParams.ts and a lockstep test asserts they agree.
precision highp float;

varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float exposure;

const float HALATION_THRESHOLD = 1.0;
const float HALATION_CAP = 4.0;
const vec3 HALATION_TINT = vec3(1.0, 0.45, 0.2);

float halationLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main(void) {
  vec3 exposed = texture2D(textureSampler, vUV).rgb * exposure;
  float l = halationLuma(exposed);
  float over = clamp(l - HALATION_THRESHOLD, 0.0, HALATION_CAP) / HALATION_CAP;
  gl_FragColor = vec4(exposed / max(l, 1.0e-4) * HALATION_TINT * over, 1.0);
}
