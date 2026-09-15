// The finish pass, last on the camera after the pipeline's chromatic
// aberration and FXAA: the peripheral overlap, luminance-weighted grain and
// a triangular dither, on display-referred sRGB. Every knob is a uniform
// from finishUnder in postParams.ts.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose. Literals mirror
// postParams.ts and a lockstep test asserts they agree.
precision highp float;

varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 texelSize;
uniform float overlapGain;
uniform float overlapPhase;
uniform float grainGain;
uniform float time;

const float OVERLAP_INNER = 0.55;
const float OVERLAP_SCALE = 1.06;
const float DITHER_LSB = 0.00392156862745098;
const float TWO_PI = 6.28318530718;

float finishLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Interleaved gradient noise on pixel coordinates plus a per-frame offset,
// the distanceFadePlugin pattern.
float finishNoise(vec2 p, float seed) {
  return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y + seed));
}

void main(void) {
  vec3 c = texture2D(textureSampler, vUV).rgb;
  vec2 centred = (vUV - 0.5) * 2.0;
  float radius = length(centred) / 1.41421356;
  float mask = smoothstep(OVERLAP_INNER, 1.0, radius) * overlapGain;
  if (mask > 0.0) {
    float breath = 0.01 * sin(overlapPhase * TWO_PI);
    vec2 mirrored = vec2(1.0 - vUV.x, vUV.y);
    vec2 echoUv = (mirrored - 0.5) / OVERLAP_SCALE + 0.5 + vec2(breath, 0.0);
    vec3 echo = texture2D(textureSampler, clamp(echoUv, 0.0, 1.0)).rgb;
    vec3 delit = vec3(finishLuma(echo)) * 0.35;
    c = 1.0 - (1.0 - c) * (1.0 - delit * mask);
  }
  vec2 pixel = vUV / texelSize;
  float l = finishLuma(c);
  float weight = (1.0 - l) * smoothstep(0.0, 0.15, l) + 0.15 * (1.0 - l);
  float g = finishNoise(pixel, fract(time * 7.31)) - 0.5;
  c += g * grainGain * weight;
  float d1 = finishNoise(pixel, fract(time * 3.17));
  float d2 = finishNoise(pixel + vec2(37.0, 11.0), fract(time * 5.03));
  c += (d1 + d2 - 1.0) * DITHER_LSB;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
