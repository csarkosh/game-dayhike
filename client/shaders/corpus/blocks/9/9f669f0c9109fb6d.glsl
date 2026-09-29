float rt = terrainRock2.x;
vec3 terrainN = vec3(0.0, 1.0, 0.0);
terrainN = normalize(vNormalW);
vec3 an = abs(terrainN);
vec3 bw = an / max(an.x + an.y + an.z, 1e-4);
float dist = distance(vPositionW.xyz, terrainEye);
float strength = vTerrainW2.y * (1.0 - smoothstep(terrainFade.x, terrainFade.y, dist));
  // Plain weights (today's blend) — grass, floor, rock, sand, pebble.
float w0 = vTerrainW.x;
float w1 = vTerrainW.y;
float w2 = vTerrainW.z;
float w3 = vTerrainW.w;
float w4 = vTerrainW2.x;
vec3 rah0 = vec3(0.5, 1.0, 0.5);
vec3 rah1 = rah0;
vec3 rah2 = rah0;
vec3 rah3 = rah0;
vec3 rah4 = rah0;
vec3 nrm = terrainN;
  // Declared out here so the AO line below still compiles — and stays a true
  // no-op — on fragments where the relief gate never runs.
float detailAo = 1.0;
  // Rock parallax: march the eye ray through the rock height on the dominant
  // triplanar face. The three offsets start at zero and only the dominant
  // face's moves, so the minority faces stay flat.
vec2 rpX = vec2(0.0);
vec2 rpY = vec2(0.0);
vec2 rpZ = vec2(0.0);
if (strength > 0.0 && w2 > 0.05) {
vec3 rDir = normalize(vPositionW.xyz - terrainEye);
float rDepth = 0.03 * rt;
vec2 rAb;
vec2 rUv;
if (bw.y >= bw.x && bw.y >= bw.z) { rAb = rDir.xz;
rUv = vPositionW.xz * rt;
}