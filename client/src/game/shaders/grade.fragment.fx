// The grade pass: the whole colour identity in one full-screen shader, run
// on linear HDR before the pipeline's chromatic aberration and FXAA. Order:
// exposure, AgX, white point, Purkinje, split-tone, lift, vignette, halation,
// sRGB encode. Every knob is a uniform from gradeRecordUnder in
// gradeParams.ts, so nothing recompiles at runtime.
//
// The AgX tone map is ported from three.js, MIT License, Copyright 2010-2024 three.js authors
// (src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js).
// Its matrices are column-major and mirrored in gradeParams.ts; a lockstep
// test asserts they agree.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.
precision highp float;

varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D halationSampler;

uniform float exposure;
uniform mat3 whitePoint;
uniform mat3 purkinje;
uniform float purkinjeThreshold;
uniform float purkinjeStrength;
uniform vec3 shadowTint;
uniform vec2 shadowAmount;
uniform vec3 midtoneTint;
uniform vec2 midtoneAmount;
uniform vec3 highlightTint;
uniform vec2 highlightAmount;
uniform float lift;
uniform float vignetteWeight;
uniform vec3 vignetteColour;
uniform float halationStrength;

const mat3 SRGB_TO_REC2020 = mat3(0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.088, 0.0433, 0.0113, 0.8956);
const mat3 REC2020_TO_SRGB = mat3(1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187);
const mat3 AGX_INSET = mat3(0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591, 0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859);
const mat3 AGX_OUTSET = mat3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272, -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
const float AGX_MIN_EV = -12.47393;
const float AGX_MAX_EV = 4.026069;

float gradeLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

// Linear sRGB in, linear sRGB in [0, 1] out. Mirrors agx() in gradeParams.ts.
vec3 agxToneMap(vec3 c) {
  vec3 v = AGX_INSET * (SRGB_TO_REC2020 * c);
  v = max(v, vec3(1.0e-10));
  v = (log2(v) - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV);
  v = clamp(v, 0.0, 1.0);
  v = agxContrast(v);
  v = AGX_OUTSET * v;
  v = pow(max(v, vec3(0.0)), vec3(2.2));
  v = REC2020_TO_SRGB * v;
  return clamp(v, 0.0, 1.0);
}

// One split-tone band: pushes the colour toward the tint by density and
// scales its saturation by (1 + saturation), weighted by the band mask.
vec3 gradeBand(vec3 c, float mask, vec3 tintColour, vec2 amount) {
  float l = gradeLuma(c);
  vec3 tinted = mix(c, tintColour * l, amount.x);
  vec3 grey = vec3(gradeLuma(tinted));
  vec3 sat = mix(grey, tinted, 1.0 + amount.y);
  return mix(c, sat, mask);
}

vec3 toSrgb(vec3 c) {
  return pow(c, vec3(1.0 / 2.2));
}

void main(void) {
  vec3 c = texture2D(textureSampler, vUV).rgb * exposure;
  c = agxToneMap(c);
  c = clamp(whitePoint * c, 0.0, 1.0);
  float l = gradeLuma(c);
  float rod = smoothstep(purkinjeThreshold, 0.0, l) * purkinjeStrength;
  c = mix(c, purkinje * c, rod);
  float shadowMask = 1.0 - smoothstep(0.0, 0.35, l);
  float highlightMask = smoothstep(0.55, 1.0, l);
  float midMask = 1.0 - shadowMask - highlightMask;
  c = gradeBand(c, shadowMask, shadowTint, shadowAmount);
  c = gradeBand(c, midMask, midtoneTint, midtoneAmount);
  c = gradeBand(c, highlightMask, highlightTint, highlightAmount);
  c = lift + c * (1.0 - lift);
  vec2 centred = (vUV - 0.5) * 2.0;
  float vig = 1.0 - smoothstep(0.4, 1.4, length(centred) * vignetteWeight * 0.5);
  c = mix(vignetteColour, c, vig);
  vec3 halo = texture2D(halationSampler, vUV).rgb * halationStrength;
  c = 1.0 - (1.0 - c) * (1.0 - clamp(halo, 0.0, 1.0));
  gl_FragColor = vec4(toSrgb(clamp(c, 0.0, 1.0)), 1.0);
}
