// The moss colour block, spliced at CUSTOM_FRAGMENT_BEFORE_LIGHTS, where
// surfaceAlbedo is the bark's colour under its tone and no light has run,
// and before the reflectivity block, so the mossed albedo is what the
// metallic workflow and the weather's wetting read. The mask: the band up
// the trunk from the varying's model height, the side from the geometric
// normal (vNormalW, not the bumped one, so the bark's relief does not
// speckle the mask), the tree's own amount from its draw, and the map's own
// growth from its luminance, then the edge. The moss map is read on the
// bark's own tiled UVs (vAlbedoUV, the albedo's, which every dressed bark
// reads through a transform) at MOSS_TILE repeats of the bark's, and
// decoded as the bark's colour map is: by the sampler where the engine
// gives the map an sRGB buffer, by the gamma helper where it does not, the
// one case the albedo's own gamma define marks. mossW is declared outside
// the braces: the roughness line reads it later (mossPlugin.ts).
//
// COMMENT RULES as in moss.vertex.fx. The block needs the albedo's
// coordinates, which exist only on a material with an albedo map, so it
// is keyed on both: a bark material always has one.
#if defined(MOSS) && defined(ALBEDO)
float mossW = 0.0;
{
  float mossBand = 1.0 - smoothstep(MOSS_BAND.x, MOSS_BAND.y, vMoss.x);
  float mossSide = smoothstep(0.0, MOSS_SIDE_EDGE, dot(normalize(vNormalW), MOSS_SIDE));
  float mossTree = mix(MOSS_AMOUNT.x, MOSS_AMOUNT.y, vMoss.y);
  vec3 mossColour = texture2D(mossSampler, vAlbedoUV * MOSS_TILE).rgb;
#ifdef GAMMAALBEDO
  mossColour = toLinearSpace(mossColour);
#endif
  float mossLuma = dot(mossColour, MOSS_LUMA);
  float mossRaw = mossBand * mossSide * mossTree;
  mossW = smoothstep(MOSS_EDGE.x, MOSS_EDGE.y, mossRaw * (0.5 + mossLuma));
  surfaceAlbedo = mix(surfaceAlbedo, mossColour * MOSS_TINT, mossW);
}
#endif
