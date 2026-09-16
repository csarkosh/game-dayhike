// The foliage colour and normal block, spliced at CUSTOM_FRAGMENT_BEFORE_LIGHTS,
// where surfaceAlbedo, normalW and viewDirectionW are established and no
// light has run: root darkening, the ground tint (strongest at the root,
// more with distance), the canopy shade, a per-clump luminance nudge, then
// the normal blended toward the ground's up at the root and forced to face
// the viewer so a card never lights as its back. The fragment is never dropped.
//
// COMMENT RULES as in foliage.vertex.fx.
#ifdef FOLIAGE
{
  const float FOLIAGE_CLUMP_LUMA = 0.16;
  surfaceAlbedo *= mix(foliageRootAO, 1.0, vFoliageH);
  float fRoot = (1.0 - vFoliageH) * (1.0 - vFoliageH);
  float fTintW = foliageTint * fRoot * (1.0 + 0.5 * smoothstep(20.0, 80.0, vFoliageDist));
  surfaceAlbedo = mix(surfaceAlbedo, vFoliage.rgb, clamp(fTintW, 0.0, 0.85));
  surfaceAlbedo *= vFoliage.a;
  surfaceAlbedo *= 1.0 + FOLIAGE_CLUMP_LUMA * (vFoliageClump - 0.5);
  normalW = normalize(mix(vec3(0.0, 1.0, 0.0), normalW, mix(foliageNormalRoot, 1.0, vFoliageH)));
  normalW = faceforward(normalW, -viewDirectionW, normalW);
}
#endif
