// The foliage sky block, spliced at CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION,
// where the sky probe's diffuse (finalIrradiance, already times the albedo,
// the ambient occlusion and the lighting intensity) and its reflection
// (finalRadianceScaled) are made and not yet summed, both of them only with
// a reflection probe: the canopy takes FOLIAGE_CANOPY_SKY of the sky's light
// from a card under full density, by the openness the instance carries in
// vFoliage.a (1 in the open, and the generic value of a draw that writes no
// foliage data, which so takes no cut). The sun's share is taken in the sun's
// diffuse (foliageDiffuse.fragment.fx) and the fill light is untouched.
// FOLIAGE_CANOPY_SKY mirrors foliagePlugin.ts and a lockstep test asserts
// they agree.
//
// COMMENT RULES as in foliage.vertex.fx.
#ifdef FOLIAGE
#ifdef REFLECTION
{
  const float FOLIAGE_CANOPY_SKY = 0.4;
  float fSky = 1.0 - FOLIAGE_CANOPY_SKY * (1.0 - vFoliage.a);
  finalIrradiance *= fSky;
  finalRadianceScaled *= fSky;
}
#endif
#endif
