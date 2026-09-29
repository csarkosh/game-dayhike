  // Same story as the relief fetch above: the height blend can still hand
  // grass a nonzero share here even at zero vertex weight, wherever the
  // other layers split the weight and a grass texel's height tops theirs, so
  // this needs a real value too — one plain fetch is enough for a share
  // this small, without paying for the three-tap hex.
vec3 grassAlbedo;
if (vTerrainW.x > 0.0) { grassAlbedo = hexFetch2D(terrainGrass, g1, g2, g3, gw, gdx, gdy) * vec3(1.6447, 1.8904, 2.7933);
}