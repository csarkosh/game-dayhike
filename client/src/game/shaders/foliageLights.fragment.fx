// The foliage colour and normal block, spliced at CUSTOM_FRAGMENT_BEFORE_LIGHTS,
// where surfaceAlbedo, normalW and viewDirectionW are established and no
// light has run: the texture's contrast compressed toward the cover's green
// (foliageContrast is the share of the texture kept, 1 the texture as it
// is: a card's texture bakes shade into its dark texels, which the gain on
// its albedo puts at the green's mean but cannot lift, so the mix lifts a
// black texel to the rest of the green), then root darkening, the ground
// tint (strongest at the root, more with distance), a per-clump luminance
// nudge, then the albedo floored (FOLIAGE_ALBEDO_FLOOR, five eighths of the
// green, after the root darkening and the tint, so nothing on the cover goes
// to black: not a blade's tip the tint has faded out of, nor a texture's
// darkest texel), then the normal blended toward the ground's up at the root
// and forced to face the viewer so a card never lights as its back. The
// canopy's cut is not on the albedo: the sky's share is taken at the final
// colour composition (foliageSky.fragment.fx) and the sun's in the sun's own
// diffuse (foliageDiffuse.fragment.fx), each from the openness in
// vFoliage.a. The fragment is never dropped.
//
// COMMENT RULES as in foliage.vertex.fx.
#ifdef FOLIAGE
{
  const float FOLIAGE_CLUMP_LUMA = 0.16;
  const float FOLIAGE_MATCH_WEIGHT = 0.7;
  surfaceAlbedo = mix(FOLIAGE_CARD_GREEN, surfaceAlbedo, foliageContrast);
  surfaceAlbedo *= mix(foliageRootAO, 1.0, vFoliageH);
  float fRoot = (1.0 - vFoliageH) * (1.0 - vFoliageH);
  // Whether this draw actually carries tint data. Babylon leaves an undeclared
  // or unfilled instance attribute at the generic (0, 0, 0, 1), which would
  // otherwise read as "the ground here is black" and mix the root toward it.
  float fHas = step(1.0 / 255.0, max(vFoliage.r, max(vFoliage.g, vFoliage.b)));
  float fTintW = foliageTint * fRoot * (1.0 + 0.5 * smoothstep(20.0, 80.0, vFoliageDist)) * fHas;
  surfaceAlbedo = mix(surfaceAlbedo, vFoliage.rgb, clamp(fTintW, 0.0, 0.85));
  surfaceAlbedo *= 1.0 + FOLIAGE_CLUMP_LUMA * (vFoliageClump - 0.5);
#ifdef FOLIAGE_MATCH
  // Matched to the ground (foliagePlugin.ts): the card's colour is drawn
  // FOLIAGE_MATCH_WEIGHT of the way to the ground's at its root, over its
  // whole height (the tint above reaches the root alone), the root
  // darkening normalised so the card's mean is the ground's. The card keeps
  // its own texture and normal, so the cover still reads as cover; the
  // ground's colour and, with the cast shadow it receives, the ground's
  // light are what it takes. Replacing the colour and the normal outright
  // made the near cover one flat carpet, ending in a line at the blade
  // field's edge. No term of distance, for the same reason. Before the
  // floor, which stays the last word on the albedo.
  if (fHas > 0.5) {
    surfaceAlbedo = mix(surfaceAlbedo, vFoliage.rgb * mix(foliageRootAO, 1.0, vFoliageH) / (0.5 * (foliageRootAO + 1.0)) * (1.0 + FOLIAGE_CLUMP_LUMA * (vFoliageClump - 0.5)), FOLIAGE_MATCH_WEIGHT);
  }
#endif
  surfaceAlbedo = max(surfaceAlbedo, FOLIAGE_ALBEDO_FLOOR);
  normalW = normalize(mix(vec3(0.0, 1.0, 0.0), normalW, mix(foliageNormalRoot, 1.0, vFoliageH)));
  normalW = faceforward(normalW, -viewDirectionW, normalW);
}
#endif
