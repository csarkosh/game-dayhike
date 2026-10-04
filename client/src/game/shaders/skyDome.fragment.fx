// The sky dome's fragment stage, built by skyDome.ts: the clear sky's slice
// of the scattering table at the sun's altitude, scaled to the scene and
// adapted, mixed toward the cloud deck, the night floor added (the moonlit
// night sky, appearing as the twilight fades), the sun's disc, then the mist's
// blend toward the fog colour at the horizon. On the
// material colour path (no post chain) it applies the image's exposure, the
// Khronos PBR Neutral tone map, the sRGB encode and the contrast itself, in
// the order Babylon's image processing applies them to every other material
// there. The probe's capture is never tone-mapped: it takes the linear
// composition with the disc capped, raised to 1/2.2, because the probe is
// flagged as gamma and every material that reads it raises it to 2.2 again.
//
// skyState.ts transcribes every step (domeRadiance, skyTableUv, deckRadiance,
// captureEncode) and a lockstep test holds the constants below to its own.
//
// The table is read once, at an explicit level, in uniform control flow: the
// disc, the capture and the tone map are chosen by step and mix on uniforms
// and the computed cosine, never by a branch around the read, so the WGSL
// translation keeps a plain textureSampleLevel.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.

uniform sampler2D skyTable;
uniform float skyScale;
uniform float skyCloud;
uniform vec3 skyDeckZenith;
uniform vec3 skyNight;
uniform vec3 skyMistAir;
uniform float skyMistWeight;
uniform vec3 skySunDir;
uniform vec3 skyDisc;
uniform float skyCapture;
uniform float skyExposure;
uniform float skyToneMap;
uniform float skyContrast;

varying vec3 vSkyDir;

const float SKY_PI = 3.14159265;
const float SKY_AZIMUTHS = 32.0;
const float SKY_ELEVATIONS = 64.0;
const float SKY_MIST_HORIZON = 0.08;
const float SKY_DISC_COS = 0.99998890;      // cos(0.27 degrees), lockstep with SUN_DISC_COS
const float SKY_DISC_CAPTURE_MAX = 1.0;
// Khronos PBR Neutral's published constants: where compression starts, and
// how far a compressed colour desaturates.
const float SKY_NEUTRAL_START = 0.76;
const float SKY_NEUTRAL_DESATURATION = 0.15;

vec2 skyTableUv(vec3 d, vec3 sunDir) {
  vec2 h = d.xz;
  vec2 s = sunDir.xz;
  float hl = length(h);
  float sl = length(s);
  float c = (hl > 1.0e-6 && sl > 1.0e-6) ? clamp(dot(h, s) / (hl * sl), -1.0, 1.0) : 1.0;
  float u = acos(c) / SKY_PI;
  float e = asin(clamp(d.y, 0.0, 1.0));
  float v = 0.5 + 0.5 * sign(e) * sqrt(abs(e) / (0.5 * SKY_PI));
  return vec2((u * (SKY_AZIMUTHS - 1.0) + 0.5) / SKY_AZIMUTHS, (v * (SKY_ELEVATIONS - 1.0) + 0.5) / SKY_ELEVATIONS);
}

vec3 skyDeck(vec3 zenith, float sinE) {
  return zenith * (1.0 + 2.0 * max(sinE, 0.0)) / 3.0;
}

// Khronos PBR Neutral, as Babylon's image processing defines it, with the
// early return for an uncompressed colour written as a selection.
vec3 skyNeutral(vec3 color) {
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  float k = 1.0 - SKY_NEUTRAL_START;
  float newPeak = 1.0 - k * k / (peak + k - SKY_NEUTRAL_START);
  float g = 1.0 - 1.0 / (SKY_NEUTRAL_DESATURATION * (peak - newPeak) + 1.0);
  vec3 compressed = mix(color * (newPeak / max(peak, 1.0e-6)), vec3(newPeak), g);
  return peak < SKY_NEUTRAL_START ? color : compressed;
}

// Babylon's contrast, after the encode, as its image processing applies it.
vec3 skyContrastOf(vec3 c) {
  vec3 high = c * c * (3.0 - 2.0 * c);
  vec3 shaped = skyContrast < 1.0 ? mix(vec3(0.5), c, skyContrast) : mix(c, high, skyContrast - 1.0);
  return max(shaped, 0.0);
}

void main(void) {
  vec3 d = normalize(vSkyDir);
  vec3 sky = skyScale * textureLod(skyTable, skyTableUv(d, skySunDir), 0.0).rgb;
  sky = mix(sky, skyDeck(skyDeckZenith, d.y), skyCloud);
  sky += skyNight;
  float inDisc = step(SKY_DISC_COS, dot(d, skySunDir));
  sky += inDisc * mix(skyDisc, min(skyDisc, vec3(SKY_DISC_CAPTURE_MAX)), skyCapture);
  float h = skyMistWeight * exp(-max(d.y, 0.0) / SKY_MIST_HORIZON);
  sky = mix(sky, skyMistAir, h);
  vec3 toned = skyNeutral(sky * skyExposure);
  toned = clamp(pow(max(toned, vec3(0.0)), vec3(1.0 / 2.2)), 0.0, 1.0);
  toned = skyContrastOf(toned);
  vec3 captured = pow(max(sky, vec3(0.0)), vec3(1.0 / 2.2));
  vec3 viewed = mix(sky, toned, step(0.5, skyToneMap));
  gl_FragColor = vec4(mix(viewed, captured, step(0.5, skyCapture)), 1.0);
}
