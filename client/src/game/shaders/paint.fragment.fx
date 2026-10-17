// The paint pass (2026-10-17): the scene's colour, still linear HDR and
// before the grade, smeared into strokes by a generalized Kuwahara filter.
// The window round each pixel is cut into eight sectors; each sector's
// mean and variance are taken with a weight that falls off across the
// sector and with distance, and the pixel becomes the means blended by how
// flat each sector is (the flattest weigh most), so an edge is kept where
// the sectors on either side of it disagree and the texture inside a
// region is flattened into a stroke, which is what a painting does with
// detail: fine grain goes, edges stay. The radius is the stroke's size in
// pixels of this frame; a strength of 0 leaves the frame as it was.
//
// After Kyprianidis, Kang and Doellner, "Image and Video Abstraction by
// Anisotropic Kuwahara Filtering" (2009), without the anisotropy: the
// sectors are round.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.
precision highp float;

varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 texel;
uniform float radius;
uniform float strength;

const int PAINT_REACH = 6;
const float PAINT_SECTOR_OVERLAP = 0.5;
const float PAINT_SECTOR_SPREAD = 2.5;
const float PAINT_SHARPNESS = 8.0;
const float PAINT_VARIANCE_SCALE = 40.0;
const float PAINT_KEEP = 24.0;
const float PAINT_CAP = 64.0;

float paintLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// The sectors are judged on the colour compressed toward 1 (c over 1 + c):
// the scene is linear HDR, and a sun seen through a crown is a texel of ten
// or a hundred that would own the variance of every sector it falls in; in
// the compressed range it is one bright texel among the others. The colour
// written is the sectors' mean of the linear colour itself, capped: a mean
// taken in the compressed range and expanded again bends a leaf against a
// bright sky toward the sky's brighter channels and turns it cyan-white.
vec3 paintCompress(vec3 c) {
  return c / (1.0 + c);
}

void main(void) {
  vec3 ownLinear = clamp(texture2D(textureSampler, vUV).rgb, vec3(0.0), vec3(PAINT_CAP));
  vec3 own = paintCompress(ownLinear);
  vec3 mean[8];
  vec3 meanLinear[8];
  vec3 square[8];
  float weight[8];
  for (int k = 0; k < 8; k++) {
    mean[k] = vec3(0.0);
    meanLinear[k] = vec3(0.0);
    square[k] = vec3(0.0);
    weight[k] = 0.0;
  }
  float r = clamp(radius, 1.0, float(PAINT_REACH));
  float zeta = 2.0 / r;
  // The window is the radius's, not the reach's: a stroke of 2 px reads 25
  // taps, not the 169 of the loop's bound.
  int reach = int(ceil(r));
  for (int j = -PAINT_REACH; j <= PAINT_REACH; j++) {
    if (j < -reach || j > reach) continue;
    for (int i = -PAINT_REACH; i <= PAINT_REACH; i++) {
      if (i < -reach || i > reach) continue;
      vec2 o = vec2(float(i), float(j));
      float d = length(o);
      if (d > r) continue;
      vec3 cLinear = clamp(texture2D(textureSampler, vUV + o * texel).rgb, vec3(0.0), vec3(PAINT_CAP));
      vec3 c = paintCompress(cLinear);
      vec2 v = o / r;
      float fall = exp(-PAINT_SECTOR_SPREAD * dot(v, v));
      for (int k = 0; k < 8; k++) {
        float a = float(k) * 0.78539816339;
        vec2 dir = vec2(cos(a), sin(a));
        vec2 perp = vec2(-dir.y, dir.x);
        float along = dot(v, dir);
        float across = dot(v, perp);
        float w = max(0.0, along + zeta - PAINT_SECTOR_OVERLAP * across * across);
        w = w * w * fall;
        mean[k] += c * w;
        meanLinear[k] += cLinear * w;
        square[k] += c * c * w;
        weight[k] += w;
      }
    }
  }
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int k = 0; k < 8; k++) {
    float wk = max(weight[k], 1.0e-5);
    vec3 m = mean[k] / wk;
    vec3 s = max(square[k] / wk - m * m, vec3(0.0));
    float sigma = sqrt(paintLuma(s));
    float w = 1.0 / (1.0 + pow(PAINT_VARIANCE_SCALE * sigma, PAINT_SHARPNESS));
    // A sector whose mean is far from the pixel's own colour weighs less: a
    // leaf against the sky would otherwise take the sky's flat sector and
    // vanish into it, every thin thing eaten by the flat ground behind it.
    vec3 away = m - own;
    w *= exp(-PAINT_KEEP * dot(away, away));
    sum += (meanLinear[k] / wk) * w;
    total += w;
  }
  vec3 painted = total > 1.0e-6 ? sum / total : ownLinear;
  gl_FragColor = vec4(mix(ownLinear, painted, strength), 1.0);
}
