if (foliageFlags.y > 0.5) {
for (int i = 0;
i < 5;
i++) {
vec2 fD = fOrigin - windPlayers[i].xz;
float fL = length(fD);
float fW = 1.0 - clamp(fL / FOLIAGE_BEND_R, 0.0, 1.0);
worldPos.xz += (fD / max(fL, 1.0e-3)) * (FOLIAGE_BEND * fH2 * fW * fW);
}