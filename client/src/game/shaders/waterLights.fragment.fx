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
// The rain's rings, every tier, scaled by the rain as the puddles' are. The
// skin's flatten below damps them where it lies.
if (waterRain > 0.0) {
  vec2 wRs = waterRainSlope(vPositionW.xz);
  normalW = normalize(normalW + vec3(wRs.x, 0.0, wRs.y) * waterRain);
}
normalW = waterHorizonNormal(normalW, viewDirectionW);
// Fresnel on N.V, Schlick with water's F0: the reflected share, which the
// transmitted light never gets.
float wNdV = clamp(dot(normalW, viewDirectionW), 0.0, 1.0);
float wF = WATER_F0 + (1.0 - WATER_F0) * pow(1.0 - wNdV, 5.0);
// The bed's light through the surface on the high tier, added after lighting
// (waterCompose.fragment.fx): it is already lit, so it is radiance, never an
// albedo for PBR to light again.
vec3 wTransmit = vec3(0.0);
if (waterHigh < 0.5) {
  // The blend scales the reflection too, so the reflected share is kept out
  // of the transmission: alpha = 1 - (1 - F) * T.
  alpha = 1.0 - (1.0 - wF) * exp(-2.0 * wKdMean * wDepth);
} else {
  vec2 wUv = gl_FragCoord.xy * waterScreen;
  // The opaque pass's device depth behind this pixel, linearised with the
  // camera's near and far into view metres.
  float wRaw = texture2D(waterDepth, wUv).r;
  float wSceneDepth = waterNearFar.x * waterNearFar.y / (waterNearFar.y - wRaw * (waterNearFar.y - waterNearFar.x));
  // How far below the surface the scene point on this eye ray lies: the ray
  // runs on past the surface by wSceneDepth / vWaterViewDepth - 1 of the
  // eye-to-surface leg, whose drop is the eye's height over the surface.
  float wRayOn = wSceneDepth / max(vWaterViewDepth, 1.0e-3) - 1.0;
  float wBehind = max(0.0, min(wDepth, (vEyePosition.y - vPositionW.y) * wRayOn));
  vec2 wOff = normalW.xz * WATER_REFRACT * min(wBehind, WATER_REFRACT_DEPTH);
  vec3 wBed = texture2D(waterScene, wUv + wOff).rgb;
  vec3 wT = exp(-2.0 * waterKd * wBehind);
  // The water's own colour where the bed is not seen: L-infinity times 1 - T.
  surfaceAlbedo *= 1.0 - wT;
  wTransmit = wBed * wT * (1.0 - wF);
  alpha = 1.0;
}

// The skin, where a murky lake carries it: a matte film of fronds over the
// water, the bed, the depth and the ripples hidden under it.
float wSkin = waterSkinMask(vPositionW.xz, wDepth);
// The sea and a clear lake skip the film.
if (waterSkin.x > 0.0) {
  surfaceAlbedo = mix(surfaceAlbedo, waterSkinColour(vPositionW.xz, vWaterViewDepth), wSkin);
  wTransmit *= 1.0 - wSkin;
  alpha = mix(alpha, 1.0, wSkin);
  normalW = normalize(mix(normalW, vec3(0.0, 1.0, 0.0), wSkin));
}
