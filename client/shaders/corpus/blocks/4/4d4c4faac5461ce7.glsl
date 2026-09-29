if (strength > 0.0) {
    // The height blend below can hand grass a nonzero share even where its
    // vertex weight is zero: wherever the other layers split the weight and
    // a grass texel's height tops theirs, b0 comes out positive. So every
    // grass term needs a real value here — the hex is skipped only because a
    // single plain fetch is enough for a share this small.
if (vTerrainW.x > 0.0) {
rah0 = hexFetchArray(terrainRAH, g1, g2, g3, gw, 0.0, gdx, gdy);
} else {