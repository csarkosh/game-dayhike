// Water plugin, before lights: per-pixel depth, the waterline, the medium
// and low tiers' alpha, and the horizon-safe normal. On the high tier the
// transmitted colour is read from the scene copy instead and the surface
// writes unblended (waterHigh is the gate, a uniform, since plugin code is
// applied before conditional evaluation).
float wDepth = waterBedDepth(vPositionW.xz);
if (wDepth <= 0.0) discard;
float wKdMean = (waterKd.r + waterKd.g + waterKd.b) / 3.0;
if (waterOctaves > 1.5) {
  vec2 wSlope = waterRipple2(vPositionW.xz);
  normalW = normalize(normalW + vec3(wSlope.x, 0.0, wSlope.y));
}
normalW = waterHorizonNormal(normalW, viewDirectionW);
if (waterHigh < 0.5) {
  // The blend scales the reflection too, so the reflected share is kept out
  // of the transmission: alpha = 1 - (1 - F) * T, F Schlick on N.V.
  float wNdV = clamp(dot(normalW, viewDirectionW), 0.0, 1.0);
  float wF = WATER_F0 + (1.0 - WATER_F0) * pow(1.0 - wNdV, 5.0);
  alpha = 1.0 - (1.0 - wF) * exp(-2.0 * wKdMean * wDepth);
} else {
  vec2 wUv = gl_FragCoord.xy * waterScreen;
  float wSceneDepth = texture2D(waterDepth, wUv).r;
  float wBehind = max(0.0, min(wDepth, wSceneDepth - waterViewDepth));
  vec2 wOff = normalW.xz * WATER_REFRACT * min(wBehind, WATER_REFRACT_DEPTH);
  vec3 wBed = texture2D(waterScene, wUv + wOff).rgb;
  vec3 wT = exp(-2.0 * waterKd * wBehind);
  surfaceAlbedo = mix(surfaceAlbedo, wBed, wT);
  alpha = 1.0;
}
