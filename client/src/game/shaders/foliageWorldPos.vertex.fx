// The foliage world-position block, spliced at CUSTOM_VERTEX_UPDATE_WORLDPOS,
// after the thin-instance matrix: worldPos, positionUpdated and finalWorld
// are in scope. Order: clump hash, the up bias on the world normal, motion
// weight, lean, gust (phased at the instance origin so a tuft moves as one),
// flutter (phased at the vertex so blades break up), camera tilt, player
// bend, far sink, then for the blade clumps the collapse: each blade pulled
// toward its root by its share of the thinning, last so a collapsed blade's
// vertices coincide exactly (the root is taken through finalWorld with no
// displacement).
//
// The motion weight carries the instance's own uniform scale — the Y column's
// length, since thin instances here are uniformly scaled — because
// foliageHeight is the MODEL bounding height while the displacement is added
// in world space. Without it a tree drawn at 5x would lean a fifth as far, in
// drawn terms, as one drawn at 1x. With it the tip lean is the same fraction
// of DRAWN height at every scale: about 2.9 % at the calmest wind, 19.8 % at
// speed 1.
//
// vPositionW is written BEFORE this hook, so fog, viewDirectionW and the
// distance fade all see the undisplaced vertex — centimetres for cards, under
// a metre for crowns, which is below what any of the three can resolve.
//
// COMMENT RULES as in foliage.vertex.fx.
#ifdef FOLIAGE
{
  const float FOLIAGE_TILT = 0.04;
  const float FOLIAGE_BEND = 0.25;
  const float FOLIAGE_BEND_R = 0.6;
  const float FOLIAGE_SINK = 0.5;
  const float FOLIAGE_BLADE_SOFT = 0.15;
  vec2 fOrigin = finalWorld[3].xz;
  float fH = clamp(positionUpdated.y / foliageHeight, 0.0, 1.0);
  float fH2 = fH * fH;
  float fDist = distance(fOrigin, windEye.xz);
  vec2 fCell = floor(fOrigin / FOLIAGE_CLUMP_CELL);
  float fClump = fract(fCell.x * 0.618034 + fCell.y * 0.381966);
  float fScale = length(finalWorld[1].xyz);
#ifdef NORMAL
  vec3 fUp = vNormalW + vec3(0.0, foliageNormalUp, 0.0);
  float fUl = length(fUp);
  vNormalW = fUl > 1.0e-4 ? fUp / fUl : vec3(0.0, 1.0, 0.0);
#endif
  float fEdge = 1.0 - smoothstep(foliageEdges.x, foliageEdges.y, fDist);
#ifdef FOLIAGE_BLADES
  fEdge = 1.0;
#endif
  float fM = foliageAmp * fH2 * foliageHeight * fScale * fEdge;
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
  // The default, overwritten only where the attribute actually exists. The
  // fragment stage treats a black rgb as "no tint data" and skips the mix.
  vFoliage = vec4(0.0, 0.0, 0.0, 1.0);
#ifdef FOLIAGE_TINT
#ifndef FOLIAGE_BLADES
  worldPos.y -= FOLIAGE_SINK * foliageHeight * smoothstep(foliageEdges.x, foliageEdges.y, fDist);
#endif
#ifdef THIN_INSTANCES
  vFoliage = foliage;
#endif
#endif
#ifdef FOLIAGE_BLADES
  vec3 bRoot = (finalWorld * vec4(blade.x, 0.0, blade.y, 1.0)).xyz;
  float bThin = smoothstep(foliageEdges.x, foliageEdges.y, fDist);
  float bAlive = clamp((blade.z - bThin * (1.0 + FOLIAGE_BLADE_SOFT)) / FOLIAGE_BLADE_SOFT + 1.0, 0.0, 1.0);
  worldPos.xyz = bRoot + (worldPos.xyz - bRoot) * bAlive;
#endif
  vFoliageH = fH;
  vFoliageClump = fClump;
  vFoliageDist = fDist;
}
#endif
