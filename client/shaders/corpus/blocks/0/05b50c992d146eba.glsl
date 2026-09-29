{
float rfi = (vPositionW.z - roadTable.x) / roadTable.y;
float rfl = clamp(floor(rfi), 0.0, roadTable.z - 2.0);
float rft = clamp(rfi - rfl, 0.0, 1.0);
float rx0 = texture(roadCenter, vec2((rfl + 0.5) / roadTable.z, 0.5)).r;
float rx1 = texture(roadCenter, vec2((rfl + 1.5) / roadTable.z, 0.5)).r;
float ru = vPositionW.x - mix(rx0, rx1, rft);
float rau = abs(ru);
float raa = fwidth(rau);
if (rau < 30.0) {
float rk = 1.0 - smoothstep(terrainFade.x, terrainFade.y, distance(vPositionW.xyz, terrainEye));
vec3 rGravelTex = mix(vec3(1.0), texture(terrainPebble, vPositionW.xz * terrainTiling.w).rgb / terrainRock2.y, rk);
vec3 rAsphaltTex = mix(vec3(1.0), texture(roadAsphalt, vec2(ru, vPositionW.z) * roadTable.w).rgb / terrainRock2.y, rk);
    // Asphalt's slice of the relief arrays:
    // the road's u axis is world X across the centreline, so it shares the
    // ground's planar frame — the same (ru, z) * roadTable.w coordinate the
    // asphalt albedo above was fetched with, on layer index 5.
vec3 rAsphaltN = texture(terrainNormals, vec3(vec2(ru, vPositionW.z) * roadTable.w, 5.0)).rgb * 2.0 - 1.0;
vec3 rAsphaltRAH = texture(terrainRAH, vec3(vec2(ru, vPositionW.z) * roadTable.w, 5.0)).rgb;
    // AO, the same mean-1 form as the ground
    // blend's own AO term in terrainTexture.ts: the packed channel is
    // normalised to mean 0.5 when the texture was made, so dividing by 0.5 turns it
    // into a multiplier centred on 1.0 rather than on asphalt's own raw mean.
rAsphaltTex *= mix(1.0, rAsphaltRAH.g / 0.5, rk);
float rVerge = 0.5 * (1.0 - smoothstep(5.5, 30.0, rau));
float rGravel = 1.0 - smoothstep(3.5, 5.5, rau);
float rE = max(0.4, raa);
float rAsphalt = 1.0 - smoothstep(3.5 - rE, 3.5 + rE, rau);
    // Normal/roughness/F0 blend toward the asphalt's own relief, faded by rk
    // the same way its albedo is, then gated by the asphalt band's coverage.
float rRelief = rAsphalt * rk;
normalW = normalize(mix(normalW, normalize(normalW + vec3(rAsphaltN.x, 0.0, rAsphaltN.y)), rRelief));
terrainRough = mix(terrainRough, clamp(terrainLayerRough2.y * mix(1.0, rAsphaltRAH.r / 0.5, rk), 0.0, 1.0), rAsphalt);
terrainF0 = mix(terrainF0, terrainLayerF02.y, rAsphalt);
float rPhase = mod(vPositionW.z, 12.0);
uint rh = uint(int(floor(vPositionW.z / 12.0))) * 2654435761u;
rh ^= rh >> 15u;
rh *= 2246822519u;
rh ^= rh >> 13u;
float rKeep = float(rh & 65535u) / 65536.0;
float rOn = (rPhase < 3.0 && rKeep < 0.65) ? 1.0 : 0.0;
float rLe = max(0.2, raa);
float rLine = rOn * 0.55 * (1.0 - smoothstep(0.15, 0.15 + rLe, rau));
vec3 rCol = mix(surfaceAlbedo, vec3(0.17, 0.14, 0.1) * vAlbedoColor.rgb, rVerge);
rCol = mix(rCol, vec3(0.3, 0.28, 0.24) * rGravelTex * vAlbedoColor.rgb, rGravel);
rCol = mix(rCol, vec3(0.14, 0.14, 0.15) * rAsphaltTex * vAlbedoColor.rgb, rAsphalt);
rCol = mix(rCol, vec3(0.42, 0.36, 0.18) * vAlbedoColor.rgb, rLine);
surfaceAlbedo = rCol;
}