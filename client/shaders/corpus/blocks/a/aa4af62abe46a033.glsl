  // The default, overwritten only where the attribute actually exists. The
  // fragment stage treats a black rgb as "no tint data" and skips the mix.
vFoliage = vec4(0.0, 0.0, 0.0, 1.0);
worldPos.y -= FOLIAGE_SINK * foliageHeight * smoothstep(foliageEdges.x, foliageEdges.y, fDist);
vFoliage = foliage;
vFoliageH = fH;
vFoliageClump = fClump;
vFoliageDist = fDist;
}