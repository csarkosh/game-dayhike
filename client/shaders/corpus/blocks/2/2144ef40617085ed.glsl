float taa = fwidth(tdBest);
  // The texture2D calls below (gravel/floor albedo, normals, RAH) run inside
  // this branch, so their implicit-LOD derivatives are formally non-uniform
  // control flow. Pre-existing structure carried over from the wall removal;
  // it compiled and rendered correctly on Metal when checked in the browser.
if (tdBest < 7.0 + taa) {
float tk = 1.0 - smoothstep(terrainFade.x, terrainFade.y, distance(vPositionW.xyz, terrainEye));
vec2 tAway = tdBest > 1.0e-4 ? tOff / tdBest : vec2(0.0);
float tRise = dot(-vNormalW.xz, tAway) / max(vNormalW.y, 1.0e-3);
    // Soil fraction: the grass + forest-floor class weights the ground blend
    // already carries (TRAILPAINT is only ever defined alongside TERRAINTEX).
float tSoil = clamp(vTerrainW.x + vTerrainW.y, 0.0, 1.0);
    // Snow fraction: the ground blend's detail weight (vTerrainW2.y) is 1 on
    // bare ground and falls to 0 through the snow band, the only thing that
    // lowers it (terrainSurface.ts). Above the snow line a trail is packed
    // snow, not a strip of bright dirt (seen in a captured clip): the bed
    // blends to a slightly darker, bluer snow, keeps the snow's normal and
    // roughness, and the bare-floor bank fades out with the soil under it.
float tSnow = 1.0 - clamp(vTerrainW2.y, 0.0, 1.0);
vec4 tRow = texture(trailSegs, vec2(tuBest, 0.75));
float tU = mix(tRow.x, tRow.y, ttBest);
float tWj = mix(tRow.z, tRow.w, ttBest);
float tWear = 0.6 * trailValueNoise1(tU, 12.0) + 0.4 * trailValueNoise1(tU, 3.0);
float tWidthK = mix(0.8, 1.25, tWear) * tWj;
float tDarkK = mix(0.85, 1.1, tWear);
float tEdgeN = 0.6 * macroValueNoise(vPositionW.xz, 1.5) + 0.4 * macroValueNoise(vPositionW.xz, 0.4);
float tdN = tdBest + 0.25 * (2.0 * tEdgeN - 1.0);
vec2 tuvP = vPositionW.xz * terrainTiling.w;
vec2 tuvF = vPositionW.xz * terrainTiling.y;
vec3 tGravelTex = mix(vec3(1.0), texture(terrainPebble, tuvP).rgb / terrainRock2.y, tk);
vec3 tFloorTex = mix(vec3(1.0), texture(terrainFloor, tuvF).rgb / terrainRock2.y, tk);
    // The bed is earth: the floor texture over the pebbles, so the trail
    // wears the colour of the ground beside it with grit in it.
vec3 tBedTex = mix(tGravelTex, tFloorTex, 0.7);
vec3 tGravelN = texture(terrainNormals, vec3(tuvP, 4.0)).rgb * 2.0 - 1.0;
vec3 tGravelRAH = texture(terrainRAH, vec3(tuvP, 4.0)).rgb;
vec3 tFloorN = texture(terrainNormals, vec3(tuvF, 1.0)).rgb * 2.0 - 1.0;
vec3 tFloorRAH = texture(terrainRAH, vec3(tuvF, 1.0)).rgb;
    // The bed's relief is earth too: a brown tint over a cobble mosaic still
    // shades as cobbles if the normal, the occlusion and the roughness stay
    // the pebble texture's. The same share that mixes the colour mixes them.
vec3 tBedN = mix(tGravelN, tFloorN, 0.7);
vec3 tBedRAH = mix(tGravelRAH, tFloorRAH, 0.7);
float tdB = tdN / tWidthK - 0.3 * (mix(0.5, tGravelRAH.b, tk) - 0.5);
float tE = max(0.08, taa / tWidthK);
float tInCore = 1.0 - smoothstep(0.45, 0.45 + tE, tdB);
float tInMargin = 1.0 - smoothstep(0.75, 0.75 + tE, tdB);
float tCore = tInCore * (1.0 - tSnow);
float tTrample = (1.0 - tInMargin) * (1.0 - smoothstep(0.75, 1.35, tdB)) * tSoil * (1.0 - tSnow);
float tBank = smoothstep(0.0, 0.15, tRise) * (1.0 - smoothstep(0.75, 7.0, tdN)) * tSoil * (1.0 - tSnow) * (1.0 - tInMargin);
vec3 tBankBase = vColor.rgb;
    // The bed's core carries no litter of its own (only drifted stretches
    // carry duff), so the vertex-colour mix above never lifted the core the
    // way the litter floor beside it rose: the bed's base mixes the same
    // NEEDLE_BED colour in by the canopy density (the fourth weight,
    // forestDensity at the vertex), so the bed under the trees reads as the
    // floor continuing under it. In the open the density is zero and nothing
    // changes. The bank keeps the raw base: it is ground beside the bed, and
    // its vertex colour already carries the litter mix.
vec3 tBedBase = mix(tBankBase, vec3(0.15, 0.105, 0.06), 0.75 * clamp(vTerrainW2.w, 0.0, 1.0));
    // The bench takes TRAIL_BENCH_SHADE of the bed's base, the ground's own
    // vertex colour with that canopy lift, rather than the material's flat
    // white, so it wears the hue of the ground it runs through — brown under
    // canopy, tan in the meadow — the way packed earth does.
vec3 tBenchBase = mix(vec3(1.0), tBedBase, 0.8);
    // The trampled band: this ground, dried and stained toward the bench.
vec3 tCol = surfaceAlbedo * mix(vec3(1.0), vec3(0.9, 0.88, 0.8), tTrample);
    // The bank: bare forest floor on the uphill side, under the vertex colour.
tCol = mix(tCol, tFloorTex * mix(1.0, tFloorRAH.g / 0.5, tk) * tBankBase, tBank);
normalW = normalize(mix(normalW, normalize(normalW + vec3(tFloorN.x, 0.0, tFloorN.y)), tBank * tk));
terrainRough = mix(terrainRough, clamp(terrainLayerRough.y * mix(1.0, tFloorRAH.r / 0.5, tk), 0.0, 1.0), tBank);
terrainF0 = mix(terrainF0, terrainLayerF0.y, tBank);
    // Core and margin: the earth bed under two tints on the bench's own
    // shaded base, the core compacted and darkened by wear, the margin loose
    // and pale at about twice the core's brightness. Wet: the core darkens
    // and glosses, the margin half as much; puddles sit in the low spots of
    // the 6 m noise inside the core.
float tAo = mix(1.0, tBedRAH.g / 0.5, tk);
vec3 tCoreCol = vec3(0.3, 0.26, 0.21) * tDarkK * tBedTex * 0.24 * tAo * tBenchBase;
vec3 tMarginCol = vec3(0.4, 0.36, 0.3) * tBedTex * 0.47 * tAo * tBenchBase;
    // Neglect: leaf and needle drifts where the ground cover says litter lies
    // (the vertex's own duff weight, so a painted drift always has pieces
    // standing on it), and gravel washed out to bare dirt in patches of the
    // bed's own noise. Both are smoothsteps and neither touches the band
    // weights above: the bed's core stays traceable however much lies on it.
float tDrift = smoothstep(0.25, 0.7, clamp(vTerrainW2.z, 0.0, 1.0));
float tWash = smoothstep(0.55, 0.8, macroValueNoise(vPositionW.xz, 4.0));
tDrift *= 1.0 - tWash;
vec3 tDriftCol = tFloorTex * vec3(0.8893440413949226, 0.6225408289764459, 0.35573761655796904) * mix(1.0, tFloorRAH.g / 0.5, tk) * tBenchBase;
    // Keyed on the canopy density, not the litter weight or the forest-floor
    // weight: the litter weight is high beside a meadow trail too (drifts
    // reach every bed margin there), and the forest-floor weight is the
    // floor-to-grass mottle raised by that litter, about a half on open
    // ground. Either would lift the meadow's wash-out toward the litter
    // floor's darkness. The canopy density is zero in the open.
float tWashDark = mix(0.4, 0.75, clamp(vTerrainW2.w, 0.0, 1.0));
vec3 tWashCol = tFloorTex * tWashDark * mix(1.0, tFloorRAH.g / 0.5, tk) * tBenchBase;
tCoreCol = mix(mix(tCoreCol, tDriftCol, tDrift), tWashCol, tWash);
tMarginCol = mix(mix(tMarginCol, tDriftCol, tDrift), tWashCol, tWash);
float tPuddleLow = smoothstep(0.62, 0.75, 1.0 - macroValueNoise(vPositionW.xz, 6.0));
float tPuddle = smoothstep(0.55, 0.8, terrainWet) * tPuddleLow * tCore;
tCoreCol *= 1.0 - 0.35 * terrainWet;
tMarginCol *= 1.0 - 0.35 * 0.5 * terrainWet;
tCoreCol = mix(tCoreCol, tCoreCol * 0.5, tPuddle);
vec3 tPacked = surfaceAlbedo * vec3(0.86, 0.88, 0.94);
float tOnBench = tInMargin;
tCol = mix(tCol, mix(mix(tMarginCol, tCoreCol, tInCore), tPacked, tSnow), tOnBench);
float tGravel = tOnBench * (1.0 - tSnow);
vec3 tBenchN = normalize(normalW + vec3(tBedN.x, 0.0, tBedN.y) * mix(1.0, 0.5, tInCore) * (1.0 - tDrift) * (1.0 - tWash) + vec3(tFloorN.x, 0.0, tFloorN.y) * tDrift);
    // The lip: over the sink ramp outside the bench the normal tilts outward
    // and down by the ramp's slope, so a low sun draws the edge as a line.
    // Reads the width-scaled distance, like the bands above it, so the drawn
    // edge follows the painted bench's own wear-and-junction width; the
    // sim's sink ramp (trailSinkD) has no such width term and always steps
    // at the bare TRAIL_BED_HALF, so the two can disagree by up to about
    // 0.5 m at a scuffed, widened junction — accepted rather than chased.
float tRamp = smoothstep(0.75, 1.25, tdN / tWidthK);
float tLip = 4.0 * tRamp * (1.0 - tRamp) * (1.0 - tSnow);
vec3 tLipN = normalize(normalW - vec3(tAway.x, 0.0, tAway.y) * 0.12 * tLip);
normalW = normalize(mix(mix(tLipN, tBenchN, tGravel * tk), vec3(0.0, 1.0, 0.0), tPuddle));
float tRoughBench = clamp(terrainLayerRough2.x * mix(1.0, tBedRAH.r / 0.5, tk), 0.0, 1.0);
tRoughBench = mix(tRoughBench, clamp(terrainLayerRough.y * mix(1.0, tFloorRAH.r / 0.5, tk), 0.0, 1.0), tDrift);
tRoughBench = mix(tRoughBench, clamp(tRoughBench * 1.15, 0.0, 1.0), tWash);
tRoughBench *= 1.0 - 0.5 * terrainWet * mix(0.5, 1.0, tInCore);
terrainRough = mix(mix(terrainRough, tRoughBench, tGravel), 0.05, tPuddle);
terrainF0 = mix(terrainF0, terrainLayerF02.x, tGravel);
surfaceAlbedo = tCol;
}