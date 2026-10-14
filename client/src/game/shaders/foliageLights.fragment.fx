// The foliage colour and normal block, spliced at CUSTOM_FRAGMENT_BEFORE_LIGHTS,
// where surfaceAlbedo, normalW and viewDirectionW are established and no
// light has run: root darkening, the ground tint (strongest at the root,
// more with distance), a per-clump luminance nudge, then the normal blended
// toward the ground's up at the root and forced to face the viewer so a card
// never lights as its back. The canopy's cut is not on the albedo: the sky's
// share is taken at the final colour composition (foliageSky.fragment.fx) and
// the sun's in the sun's own diffuse (foliageDiffuse.fragment.fx), each from
// the openness in vFoliage.a. The fragment is never dropped.
//
// COMMENT RULES as in foliage.vertex.fx.
#ifdef FOLIAGE
{
  const float FOLIAGE_CLUMP_LUMA = 0.16;
  surfaceAlbedo *= mix(foliageRootAO, 1.0, vFoliageH);
  float fRoot = (1.0 - vFoliageH) * (1.0 - vFoliageH);
  // Whether this draw actually carries tint data. Babylon leaves an undeclared
  // or unfilled instance attribute at the generic (0, 0, 0, 1), which would
  // otherwise read as "the ground here is black" and mix the root toward it.
  float fHas = step(1.0 / 255.0, max(vFoliage.r, max(vFoliage.g, vFoliage.b)));
  float fTintW = foliageTint * fRoot * (1.0 + 0.5 * smoothstep(20.0, 80.0, vFoliageDist)) * fHas;
  surfaceAlbedo = mix(surfaceAlbedo, vFoliage.rgb, clamp(fTintW, 0.0, 0.85));
  surfaceAlbedo *= 1.0 + FOLIAGE_CLUMP_LUMA * (vFoliageClump - 0.5);
  normalW = normalize(mix(vec3(0.0, 1.0, 0.0), normalW, mix(foliageNormalRoot, 1.0, vFoliageH)));
  normalW = faceforward(normalW, -viewDirectionW, normalW);
}
#endif
