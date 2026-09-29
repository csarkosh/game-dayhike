float above = smoothstep(fMeta.x - fMeta.y, fMeta.x, vPositionW.y);
float near = 1.0 - smoothstep(f.z - fRim.x, f.z, fd);
float crest = 1.0 - smoothstep(25.0, 40.0, fd);
float rock = max(above * near, crest);
float fLum = dot(surfaceAlbedo, vec3(0.299, 0.587, 0.114));
surfaceAlbedo = mix(surfaceAlbedo, vec3(fLum) * 1.1, rock * 0.85);
}