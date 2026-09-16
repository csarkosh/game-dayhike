// The foliage world-position block, spliced at CUSTOM_VERTEX_UPDATE_WORLDPOS,
// after the thin-instance matrix: worldPos, positionUpdated and finalWorld
// are in scope. Order: clump hash, motion weight, lean, gust (phased at the
// instance origin so a tuft moves as one), flutter (phased at the vertex so
// blades break up), camera tilt, player bend, far sink.
//
// COMMENT RULES as in foliage.vertex.fx.
#ifdef FOLIAGE
{
  const float FOLIAGE_TILT = 0.04;
  const float FOLIAGE_BEND = 0.25;
  const float FOLIAGE_BEND_R = 0.6;
  const float FOLIAGE_SINK = 0.5;
  vec2 fOrigin = finalWorld[3].xz;
  float fH = clamp(positionUpdated.y / foliageHeight, 0.0, 1.0);
  float fH2 = fH * fH;
  float fDist = distance(fOrigin, windEye.xz);
  vec2 fCell = floor(fOrigin / FOLIAGE_CLUMP_CELL);
  float fClump = fract(fCell.x * 0.618034 + fCell.y * 0.381966);
  float fM = foliageAmp * fH2 * foliageHeight * (1.0 - smoothstep(foliageEdges.x, foliageEdges.y, fDist));
  vec3 fDir = vec3(windDir.x, 0.0, windDir.y);
  float fGust = foliageGust(fOrigin, windTime + 0.6 * (fClump - 0.5));
  worldPos.xyz += fDir * (windLean + windGust * fGust) * fM;
  float fFlutter = sin(2.1 * worldPos.x + 1.7 * worldPos.z + WIND_OMEGA3 * windTime);
  worldPos.xz += windFlutter * fM * fFlutter * vec2(0.75, -0.35);
  if (foliageFlags.x > 0.5) {
    vec2 fAway = fOrigin - windEye.xz;
    worldPos.xz += FOLIAGE_TILT * fH2 * fAway / max(length(fAway), 1.0e-3);
  }
  if (foliageFlags.y > 0.5) {
    for (int i = 0; i < 5; i++) {
      vec2 fD = fOrigin - windPlayers[i].xz;
      float fL = length(fD);
      float fW = 1.0 - clamp(fL / FOLIAGE_BEND_R, 0.0, 1.0);
      worldPos.xz += (fD / max(fL, 1.0e-3)) * (FOLIAGE_BEND * fH2 * fW * fW);
    }
  }
#ifdef FOLIAGE_TINT
  worldPos.y -= FOLIAGE_SINK * foliageHeight * smoothstep(foliageEdges.x, foliageEdges.y, fDist);
#ifdef THIN_INSTANCES
  vFoliage = foliage;
#else
  vFoliage = vec4(0.0, 0.0, 0.0, 1.0);
#endif
#else
  vFoliage = vec4(0.0, 0.0, 0.0, 1.0);
#endif
  vFoliageH = fH;
  vFoliageClump = fClump;
  vFoliageDist = fDist;
}
#endif
