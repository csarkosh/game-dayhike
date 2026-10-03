// Water plugin, before lights: per-pixel depth, the waterline, the medium
// and low tiers' alpha, and the horizon-safe normal. On the high tier the
// transmitted colour is read from the scene copy instead and the surface
// writes unblended (waterHigh is the gate, a uniform, since plugin code is
// applied before conditional evaluation).
#ifdef OCEAN
// The sea's swell at this pixel's undisplaced point, its drawn waves faded
// by the pixel's own footprint (the derivatives are taken here, in uniform
// control flow, before any branch). The depth is the displaced surface's
// over the bed, so the water's edge rises and falls with each wave.
vec2 wOceanDx = dFdx(vOceanXZ);
vec2 wOceanDy = dFdy(vOceanXZ);
vec3 wOceanDisp;
vec3 wOceanNormal;
vec4 wOceanFoam;
float wOceanDrawn;
oceanSwellSum(vOceanXZ, wOceanDx, wOceanDy, wOceanDisp, wOceanNormal, wOceanFoam, wOceanDrawn);
float wOceanChop = oceanShelter(vOceanXZ, SHELTER_CHOP);
// The wind sea here: its height for the water's edge and the whitecaps, its
// slopes faded by the pixel's footprint, both scaled by its share of the
// fully developed sea here, which the fetch off the land, the broken waves
// and the headland's lee cut down. The fetch's share is read once, here, for
// everything below that takes it.
float wWindShare = oceanWindAmp(vOceanXZ);
float wWindAmp = wWindShare * (1.0 - wOceanFoam.y) * wOceanChop;
vec3 wWind = oceanWindDisplace(vOceanXZ);
float wWindDrawn;
vec2 wWindSlope = oceanWindSlopesAt(vOceanXZ, max(length(wOceanDx), length(wOceanDy)), wWindDrawn);
float wDepth = waterBedDepth(vPositionW.xz) + wOceanDisp.y + wWind.y * wWindAmp;
#else
float wDepth = waterBedDepth(vPositionW.xz);
#endif
if (wDepth <= 0.0) discard;
float wKdMean = (waterKd.r + waterKd.g + waterKd.b) / 3.0;
#ifdef OCEAN
// The sea's normal is the swell's with the wind sea's slopes on it. PBR's
// bump is on the sea on the low tier alone, where its slope rides on the
// swell's, scaled by the wind sea's height: elsewhere normalW is still the
// ring's up and adds nothing. The second octave never runs on the sea.
float wWindSteep = wWindAmp * oceanWindSlopeLimit(oceanWindDir.z, wOceanChop, wWindDrawn * wWindAmp * wWindAmp);
vec2 wOceanExtra = normalW.xz / max(normalW.y, 0.05) * oceanBumpScale(wWindShare, wOceanFoam.y, wOceanChop) + wWindSlope * wWindSteep;
normalW = normalize(wOceanNormal + vec3(wOceanExtra.x, 0.0, wOceanExtra.y) * wOceanNormal.y);
// What Cox and Munk's slope variance for the wind leaves to the roughness
// once the drawn waves carry theirs, calmer in a headland's lee as the chop is.
float wOceanVar = oceanUndrawnVariance(oceanWindDir.z, wOceanChop, wOceanDrawn + wWindDrawn * wWindSteep * wWindSteep);
#else
if (waterOctaves > 1.5) {
  vec2 wSlope = waterRipple2(vPositionW.xz);
  normalW = normalize(normalW + vec3(wSlope.x, 0.0, wSlope.y));
}
#endif
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
#ifdef OCEAN
// The white water, a matte layer over the sea the way the skin is over a
// lake: the swell's foam through its lace, and the whitecaps, which the
// broken waves eat shoreward of the break. The foam's cover is its amount
// through the lace, a sheet at the roll and thinning behind, over the inner
// surf's floor. Its albedo is the foam's by its age, a whitecap's fresh. Both
// patterns fade to their mean where a pixel spans more than a few of their
// cells.
float wOceanPixel = max(length(wOceanDx), length(wOceanDy));
float wFoamAge = oceanFoamLookAge(wOceanFoam.z);
float wOceanLace = oceanFoamCover(vOceanXZ, wOceanFoam.x, wOceanFoam.y, wOceanPixel);
float wOceanCap;
if (oceanCoast.w > 0.5) {
  // A drawn wind sea's own crests, faded to their coverage as the waves that
  // shape them fall under the pixel, as the cells fade where none is drawn.
  float wCapCover = oceanCapCoverage(vOceanXZ, wWindShare);
  wOceanCap = mix(wCapCover, oceanWhitecap(wCapCover, wWind.y / max(oceanWindStats.x, 1.0e-4)), oceanCrestKeep(wOceanPixel));
} else {
  wOceanCap = oceanCapCells(vOceanXZ, wOceanPixel, wWindShare);
}
wOceanCap *= 1.0 - wOceanFoam.y;
float wFoam = max(wOceanLace, wOceanCap);
float wFoamWhite = wOceanLace >= wOceanCap ? oceanFoamWhite(wFoamAge) : OCEAN_FOAM_ALBEDO;
surfaceAlbedo = mix(surfaceAlbedo, vec3(wFoamWhite), wFoam);
wTransmit *= 1.0 - wFoam;
alpha = mix(alpha, 1.0, wFoam);
normalW = normalize(mix(normalW, vec3(0.0, 1.0, 0.0), wFoam));
#endif
