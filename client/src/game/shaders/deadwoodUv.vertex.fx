// Deadwood plugin, at the vertex's end: the bark's coordinates laid along the
// trunk (the model's x) and round it (the turn about the trunk's axis), in
// the set's own metres at the instance's scale, so the plates stay life-size
// on a trunk drawn two or three times its model, a whole number of tiles
// round so the seam closes, written over the material's own coordinates for
// its colour, its normal and its roughness maps alike: the mesh's first uv
// set, which the three maps read straight (no transform of their own), and
// the map's own coordinates where it has a transform. Then the varying: the
// role, the height over the snag's base (the model's x past it, in metres at
// the instance's scale, as the moss band is measured on a trunk), the model's
// own y (the log's underside is low in it), and the foot's hash.
#ifdef DEADWOOD
{
  float dwScale = length(finalWorld[0].xyz);
  float dwAlong = positionUpdated.x * dwScale * deadwoodBark.x;
  float dwTurn = atan(positionUpdated.y - deadwoodAxis.x, positionUpdated.z - deadwoodAxis.y) / 6.283185307179586;
  float dwTiles = max(1.0, floor(6.283185307179586 * deadwoodBark.z * dwScale * deadwoodBark.y + 0.5));
  vec2 dwUv = vec2(dwTurn * dwTiles, dwAlong);
#ifdef MAINUV1
  vMainUV1 = dwUv;
#endif
#if defined(ALBEDO) && ALBEDODIRECTUV == 0
  vAlbedoUV = dwUv;
#endif
#if defined(BUMP) && BUMPDIRECTUV == 0
  vBumpUV = dwUv;
#endif
#if defined(REFLECTIVITY) && REFLECTIVITYDIRECTUV == 0
  vReflectivityUV = dwUv;
#endif
  vDeadwood = vec4(deadwoodRole, (positionUpdated.x + deadwoodBark.w) * dwScale, positionUpdated.y, deadwoodHash(finalWorld[3].xz));
}
#endif
