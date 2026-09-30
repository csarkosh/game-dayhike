float wetW = wetWeight(vPositionW.y, wetLine);
surfaceAlbedo *= mix(1.0, WET_ALBEDO, wetW);
surfaceAlbedo *= mix(vec3(1.0), exp(-wetKd * max(0.0, wetLine - vPositionW.y)), wetAttenuate);
