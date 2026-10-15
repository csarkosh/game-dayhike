// Deadwood plugin, before the lights: the moss and the contact band on the
// bark's colour, where no light has run. A log (the role 1) is mossed on its
// upper side by the world normal's rise, over its whole length, and darkened
// toward its underside where it meets the floor; a snag (the role 0) is
// mossed as a trunk is, on the wet side and low on the trunk, its height the
// model's x over its base. Both by the tree's own draw (a log's from
// DEADWOOD_LOG_DRAW up: the wet floor's trunks are the mossier) and the
// map's own growth, the moss sampled at the bark's coordinates. The weight is left
// outside the braces for the roughness, written before Babylon's own line.
#if defined(DEADWOOD) && defined(ALBEDO)
float mossW = 0.0;
{
  vec3 dwN = normalize(vNormalW);
  float dwLog = vDeadwood.x;
  float dwBand = mix(1.0 - smoothstep(MOSS_BAND.x, MOSS_BAND.y, vDeadwood.y), 1.0, dwLog);
  float dwSide = mix(smoothstep(0.0, MOSS_SIDE_EDGE, dot(dwN, MOSS_SIDE)), smoothstep(DEADWOOD_UP.x, DEADWOOD_UP.y, dwN.y), dwLog);
  float dwTree = mix(MOSS_AMOUNT.x, MOSS_AMOUNT.y, mix(vDeadwood.w, mix(DEADWOOD_LOG_DRAW, 1.0, vDeadwood.w), dwLog));
  vec3 mossColour = texture2D(mossSampler, vAlbedoUV * MOSS_TILE).rgb;
#ifdef GAMMAALBEDO
  mossColour = toLinearSpace(mossColour);
#endif
  float mossLuma = dot(mossColour, MOSS_LUMA);
  float mossRaw = dwBand * dwSide * dwTree;
  mossW = smoothstep(MOSS_EDGE.x, MOSS_EDGE.y, mossRaw * (0.5 + mossLuma));
  surfaceAlbedo = mix(surfaceAlbedo, mossColour * MOSS_TINT, mossW);
  float dwContact = mix(DEADWOOD_CONTACT, 1.0, smoothstep(DEADWOOD_CONTACT_BAND.x, DEADWOOD_CONTACT_BAND.y, vDeadwood.z));
  surfaceAlbedo *= mix(1.0, dwContact, dwLog);
}
#endif
