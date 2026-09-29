vec3 blended =
grassAlbedo * w0
+ texture(terrainFloor,  uvF).rgb * vec3(1.5456, 2.0202, 2.8329) * w1
+ texture(terrainSand,   uvS).rgb * vec3(1.7036, 1.9531, 2.5316) * w3
+ texture(terrainPebble, uvP).rgb * vec3(1.8484, 2.0121, 2.1882) * w4
+ w2 * vec3(1.8519, 1.9763, 2.2272) * (
texture(terrainRock, vPositionW.yz * rt + rpX).rgb * bw.x
+ texture(terrainRock, vPositionW.xz * rt + rpY).rgb * bw.y
+ texture(terrainRock, vPositionW.xy * rt + rpZ).rgb * bw.z);
float ao = rah0.g * w0 + rah1.g * w1 + rah2.g * w2 + rah3.g * w3 + rah4.g * w4;
  // AO: the packed channel is normalised to a mean of 0.5 per
  // layer when the texture was made, so dividing the blended
  // value back by 0.5 turns it into a mean-1 multiplier — every layer darkens
  // around its own occlusion variation rather than around wherever its raw
  // source map's mean happened to land.
surfaceAlbedo *= mix(vec3(1.0), blended, strength) * mix(1.0, ao / 0.5, strength) * detailAo;
  // Macro tint: the lush/dry variation over tens of metres, on grass only and
  // faded out with the rest of the detail. A multiplicative tint of
  // surfaceAlbedo, never a write to the material constant.
vec3 macroRgb = macroTint(macroNoise(vPositionW.xz), 1.0 - terrainN.y);
surfaceAlbedo *= mix(vec3(1.0), macroRgb, w0 * terrainMacroOn * (1.0 - smoothstep(terrainFade.x, terrainFade.y, dist)));
  // Horizon tint: past HORIZON the floor reads as the vegetation the clutter
  // has thinned out of, not as bare palette.
surfaceAlbedo = mix(surfaceAlbedo, terrainTuft, w0 * horizonWeight(dist));
  // Sward floor: inside the blade field's reach, ground carrying a sward reads
  // as the shaded thatch between the blades, not bare ground. Keyed on the
  // ground cover, not the grass texture weight, which is a mottle.
float swardW = terrainSward.w * smoothstep(terrainSwardBand.x, terrainSwardBand.y, vTerrainCover) * (1.0 - smoothstep(terrainSwardBand.z, terrainSwardBand.w, dist));
surfaceAlbedo = mix(surfaceAlbedo, terrainSward.rgb, swardW);
  // Roughness: the blended per-layer base,
  // modulated near the eye by the blended map over its own 0.5 neutral (so a
  // flat 0.5 placeholder or a failed decode is the identity, not a flash of
  // gloss); F0: per layer, never faded.
float rBase = terrainLayerRough.x * w0 + terrainLayerRough.y * w1 + terrainLayerRough.z * w2 + terrainLayerRough.w * w3 + terrainLayerRough2.x * w4;
float rMap = rah0.r * w0 + rah1.r * w1 + rah2.r * w2 + rah3.r * w3 + rah4.r * w4;
terrainRough = clamp(rBase * mix(1.0, rMap / 0.5, strength), 0.0, 1.0);
terrainF0 = terrainLayerF0.x * w0 + terrainLayerF0.y * w1 + terrainLayerF0.z * w2 + terrainLayerF0.w * w3 + terrainLayerF02.x * w4;
}