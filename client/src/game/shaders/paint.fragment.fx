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
// The eight sectors' sums are eight sets of named variables, added to by a
// function called eight times a tap with the sector's direction a constant,
// never an array indexed by the sector: an array in a function's scope
// indexed at run time is kept in memory by one translation of this shader
// and read back at every tap, at several times the cost on one engine and
// a little on the other (the design doc has the pair). The window's loops
// run to the radius, not to the reach: the reach is only the most a radius
// may be.
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

void paintTap(vec3 c, vec3 cLinear, vec2 v, float w, float zeta, vec2 dir, inout vec3 mean, inout vec3 meanLinear, inout vec3 square, inout float weight) {
  float along = dot(v, dir);
  float across = dot(v, vec2(-dir.y, dir.x));
  float s = max(0.0, along + zeta - PAINT_SECTOR_OVERLAP * across * across);
  s = s * s * w;
  mean += c * s;
  meanLinear += cLinear * s;
  square += c * c * s;
  weight += s;
}

void paintSector(vec3 own, vec3 mean, vec3 meanLinear, vec3 square, float weight, inout vec3 sum, inout float total) {
  float wk = max(weight, 1.0e-5);
  vec3 m = mean / wk;
  vec3 s = max(square / wk - m * m, vec3(0.0));
  float sigma = sqrt(paintLuma(s));
  float w = 1.0 / (1.0 + pow(PAINT_VARIANCE_SCALE * sigma, PAINT_SHARPNESS));
  // A sector whose mean is far from the pixel's own colour weighs less: a
  // leaf against the sky would otherwise take the sky's flat sector and
  // vanish into it, every thin thing eaten by the flat ground behind it.
  vec3 away = m - own;
  w *= exp(-PAINT_KEEP * dot(away, away));
  sum += (meanLinear / wk) * w;
  total += w;
}

void main(void) {
  vec3 ownLinear = clamp(textureLod(textureSampler, vUV, 0.0).rgb, vec3(0.0), vec3(PAINT_CAP));
  vec3 own = paintCompress(ownLinear);
  float r = clamp(radius, 1.0, float(PAINT_REACH));
  float zeta = 2.0 / r;
  int reach = int(ceil(r));
  vec3 m0 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0), m3 = vec3(0.0), m4 = vec3(0.0), m5 = vec3(0.0), m6 = vec3(0.0), m7 = vec3(0.0);
  vec3 l0 = vec3(0.0), l1 = vec3(0.0), l2 = vec3(0.0), l3 = vec3(0.0), l4 = vec3(0.0), l5 = vec3(0.0), l6 = vec3(0.0), l7 = vec3(0.0);
  vec3 q0 = vec3(0.0), q1 = vec3(0.0), q2 = vec3(0.0), q3 = vec3(0.0), q4 = vec3(0.0), q5 = vec3(0.0), q6 = vec3(0.0), q7 = vec3(0.0);
  float w0 = 0.0, w1 = 0.0, w2 = 0.0, w3 = 0.0, w4 = 0.0, w5 = 0.0, w6 = 0.0, w7 = 0.0;
  for (int j = -reach; j <= reach; j++) {
    for (int i = -reach; i <= reach; i++) {
      vec2 o = vec2(float(i), float(j));
      if (dot(o, o) > r * r) continue;
      vec2 v = o / r;
      float fall = exp(-PAINT_SECTOR_SPREAD * dot(v, v));
      vec3 cLinear = clamp(textureLod(textureSampler, vUV + o * texel, 0.0).rgb, vec3(0.0), vec3(PAINT_CAP));
      vec3 c = paintCompress(cLinear);
      paintTap(c, cLinear, v, fall, zeta, vec2(1.0, 0.0), m0, l0, q0, w0);
      paintTap(c, cLinear, v, fall, zeta, vec2(0.70710678, 0.70710678), m1, l1, q1, w1);
      paintTap(c, cLinear, v, fall, zeta, vec2(0.0, 1.0), m2, l2, q2, w2);
      paintTap(c, cLinear, v, fall, zeta, vec2(-0.70710678, 0.70710678), m3, l3, q3, w3);
      paintTap(c, cLinear, v, fall, zeta, vec2(-1.0, 0.0), m4, l4, q4, w4);
      paintTap(c, cLinear, v, fall, zeta, vec2(-0.70710678, -0.70710678), m5, l5, q5, w5);
      paintTap(c, cLinear, v, fall, zeta, vec2(0.0, -1.0), m6, l6, q6, w6);
      paintTap(c, cLinear, v, fall, zeta, vec2(0.70710678, -0.70710678), m7, l7, q7, w7);
    }
  }
  vec3 sum = vec3(0.0);
  float total = 0.0;
  paintSector(own, m0, l0, q0, w0, sum, total);
  paintSector(own, m1, l1, q1, w1, sum, total);
  paintSector(own, m2, l2, q2, w2, sum, total);
  paintSector(own, m3, l3, q3, w3, sum, total);
  paintSector(own, m4, l4, q4, w4, sum, total);
  paintSector(own, m5, l5, q5, w5, sum, total);
  paintSector(own, m6, l6, q6, w6, sum, total);
  paintSector(own, m7, l7, q7, w7, sum, total);
  vec3 painted = total > 1.0e-6 ? sum / total : ownLinear;
  gl_FragColor = vec4(mix(ownLinear, painted, strength), 1.0);
}
