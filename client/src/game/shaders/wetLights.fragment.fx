float wetIn = wetInside(vPositionW.xz, wetCentre, wetRadius);
float wetW = wetBelow(vPositionW.y, wetLine) * wetIn;
// Inside the cove the swash's table wets the face as well (wetShore): soaked
// up to the still line or the column's reach, whichever is higher, then damp
// and speckled. Outside it the three are 0 and the still line's look is as
// it was, to the bit.
vec3 wetCoveW = wetShore(vPositionW.xz, vPositionW.y) * wetIn;
wetW = max(wetW, wetCoveW.x);
float wetDamp = wetCoveW.y * (1.0 - wetW);
surfaceAlbedo *= mix(1.0, WET_ALBEDO, wetW) * mix(1.0, WET_DAMP_ALBEDO, wetDamp);
surfaceAlbedo = mix(surfaceAlbedo, vec3(1.0), wetCoveW.z * wetSpeckle(vPositionW.xz, length(vPositionW - vEyePosition.xyz)));
float wetKdMean = (wetKd.r + wetKd.g + wetKd.b) / 3.0;
vec3 wetResidual = min(vec3(1.0), exp(-2.0 * (wetKd - vec3(wetKdMean)) * max(0.0, wetLevel - vPositionW.y) * wetIn));
surfaceAlbedo *= mix(vec3(1.0), wetResidual, wetAttenuate);
