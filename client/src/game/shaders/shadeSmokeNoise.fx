// The shades' smoke (shadeSmoke.ts): value noise in three dimensions on a
// hash, no sampler, and three octaves of it. Shared by the vertex stage, which
// swells the figure's outline by it, and the fragment stage, which dissolves
// the figure through it.
const float SHADE_SMOKE_SCALE = 0.9;
const float SHADE_SMOKE_RISE = 0.6;
const float SHADE_SMOKE_SOFT = 0.12;
const float SHADE_SMOKE_FEET = 0.16;

float shadeSmokeHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float shadeSmokeNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = shadeSmokeHash(i);
  float n100 = shadeSmokeHash(i + vec3(1.0, 0.0, 0.0));
  float n010 = shadeSmokeHash(i + vec3(0.0, 1.0, 0.0));
  float n110 = shadeSmokeHash(i + vec3(1.0, 1.0, 0.0));
  float n001 = shadeSmokeHash(i + vec3(0.0, 0.0, 1.0));
  float n101 = shadeSmokeHash(i + vec3(1.0, 0.0, 1.0));
  float n011 = shadeSmokeHash(i + vec3(0.0, 1.0, 1.0));
  float n111 = shadeSmokeHash(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

float shadeSmokeFbm(vec3 p) {
  float v = 0.5 * shadeSmokeNoise(p);
  v += 0.25 * shadeSmokeNoise(p * 2.03 + vec3(1.7, 9.2, 4.4));
  v += 0.125 * shadeSmokeNoise(p * 4.01 + vec3(8.3, 2.8, 6.1));
  return v / 0.875;
}

// Where a point of the figure is in the smoke at a time: the noise rises
// through the figure at SHADE_SMOKE_RISE metres a second.
vec3 shadeSmokeAt(vec3 world, float seconds) {
  return world * SHADE_SMOKE_SCALE + vec3(0.0, -seconds * SHADE_SMOKE_RISE * SHADE_SMOKE_SCALE, 0.0);
}
