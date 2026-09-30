float wetW = wetWeight(vPositionW, wetLine, wetCentre, wetRadius);
surfaceAlbedo *= mix(1.0, WET_ALBEDO, wetW);
float wetKdMean = (wetKd.r + wetKd.g + wetKd.b) / 3.0;
vec3 wetResidual = min(vec3(1.0), exp(-2.0 * (wetKd - vec3(wetKdMean)) * max(0.0, wetLevel - vPositionW.y)));
surfaceAlbedo *= mix(vec3(1.0), wetResidual, wetAttenuate);
