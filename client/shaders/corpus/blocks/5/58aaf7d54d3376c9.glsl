float shore = 1.0 - smoothstep(f.z + fMeta.w, f.z + fMeta.w + 2.0, fd);
surfaceAlbedo *= mix(vec3(1.0), vec3(0.85, 0.78, 0.70), shore * 0.8);
} else if (f.w > 0.5) {