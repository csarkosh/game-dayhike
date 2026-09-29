rah1 = texture(terrainRAH, vec3(uvF, 1.0)).rgb;
rah2 = texture(terrainRAH, vec3(vPositionW.xz * rt + rpY, 2.0)).rgb;
rah3 = texture(terrainRAH, vec3(uvS, 3.0)).rgb;
rah4 = texture(terrainRAH, vec3(uvP, 4.0)).rgb;
    // Height blend: the tallest layer within the depth constant
    // below still shows through.
float m = max(max(w0 + rah0.b, w1 + rah1.b), max(max(w2 + rah2.b, w3 + rah3.b), w4 + rah4.b)) - 0.200;
float b0 = max(w0 + rah0.b - m, 0.0);
float b1 = max(w1 + rah1.b - m, 0.0);
float b2 = max(w2 + rah2.b - m, 0.0);
float b3 = max(w3 + rah3.b - m, 0.0);
float b4 = max(w4 + rah4.b - m, 0.0);
float bs = max(b0 + b1 + b2 + b3 + b4, 1e-4);
    // terrainReliefOn: 0 until the real RAH array has
    // landed, so a flat placeholder height (equal on every layer) can never
    // sharpen the class weights into hard edges the way the raw formula
    // above would (0.5/0.3/0.2 -> 1/0/0). With it 0, b collapses back to w
    // before the strength fade below ever runs.
b0 = mix(w0, b0 / bs, terrainReliefOn);
b1 = mix(w1, b1 / bs, terrainReliefOn);
b2 = mix(w2, b2 / bs, terrainReliefOn);
b3 = mix(w3, b3 / bs, terrainReliefOn);
b4 = mix(w4, b4 / bs, terrainReliefOn);
w0 = mix(w0, b0, strength);
w1 = mix(w1, b1, strength);
w2 = mix(w2, b2, strength);
w3 = mix(w3, b3, strength);
w4 = mix(w4, b4, strength);
    // Normals, UDN-style: the map's xy is added to the world normal in the
    // projection's frame. Planar layers: uv is world XZ, so x -> X, y -> Z.
vec3 t0;
if (vTerrainW.x > 0.0) {
t0 = hexFetchArray(terrainNormals, g1, g2, g3, gw, 0.0, gdx, gdy) * 2.0 - 1.0;
} else {