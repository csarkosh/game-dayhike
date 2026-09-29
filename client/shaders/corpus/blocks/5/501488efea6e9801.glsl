  // The default, overwritten only where the attribute actually exists. The
  // fragment stage treats a black rgb as "no tint data" and skips the mix.
vFoliage = vec4(0.0, 0.0, 0.0, 1.0);
vFoliage = foliage;
vec3 bRoot = (finalWorld * vec4(blade.x, 0.0, blade.y, 1.0)).xyz;
float bStrength = 1.0;
bStrength = bladeStrength;
float bGrow = smoothstep(foliageBladeEdges.x, foliageBladeEdges.y, fDist);
float bThin = smoothstep(foliageBladeEdges.z, foliageBladeEdges.w, fDist);
float bIn = clamp(((1.0 + FOLIAGE_BLADE_SOFT) * bGrow - blade.z) / FOLIAGE_BLADE_SOFT, 0.0, 1.0);
float bOut = clamp((blade.z - bThin * (1.0 + FOLIAGE_BLADE_SOFT)) / FOLIAGE_BLADE_SOFT + 1.0, 0.0, 1.0);
float bR2 = fract(blade.x * 37.31 + blade.y * 91.17 + 0.37);
float bAlive = bIn * bOut * step(bR2, bStrength);
worldPos.xyz = bRoot + (worldPos.xyz - bRoot) * bAlive;
vFoliageH = fH;
vFoliageClump = fClump;
vFoliageDist = fDist;
}