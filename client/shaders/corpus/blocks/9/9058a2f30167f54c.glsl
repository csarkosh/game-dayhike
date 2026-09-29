vec3 t1 = texture(terrainNormals, vec3(uvF, 1.0)).rgb * 2.0 - 1.0;
vec3 t3 = texture(terrainNormals, vec3(uvS, 3.0)).rgb * 2.0 - 1.0;
vec3 t4 = texture(terrainNormals, vec3(uvP, 4.0)).rgb * 2.0 - 1.0;
vec3 tx = texture(terrainNormals, vec3(vPositionW.yz * rt + rpX, 2.0)).rgb * 2.0 - 1.0;
vec3 ty = texture(terrainNormals, vec3(vPositionW.xz * rt + rpY, 2.0)).rgb * 2.0 - 1.0;
vec3 tz = texture(terrainNormals, vec3(vPositionW.xy * rt + rpZ, 2.0)).rgb * 2.0 - 1.0;
vec2 planar = t0.xy * w0 + t1.xy * w1 + t3.xy * w3 + t4.xy * w4;
    // The near-eye detail scale: the same grass maps at DETAIL_TILING, hex
    // tiled again so the small repeat does not draw its own grid either. Gated
    // on grass weight AND its own fade, inside the relief gate, so the two
    // extra fetches land on grass within DETAIL_FADE of the eye and nowhere
    // else — and on terrainReliefOn, since a flat placeholder normal/height
    // would only add noise. The finer scale adds a normal and a
    // between-blades occlusion; an albedo term was tried and could not be
    // seen with these maps, so it is not fetched.
float detailStrength = w0 * (1.0 - smoothstep(terrainDetail.y, terrainDetail.z, dist)) * terrainReliefOn;
if (detailStrength > 0.0) {
vec2 d1;
vec2 d2;
vec2 d3;
vec3 dw;
hexSetup(uvD, d1, d2, d3, dw);
vec3 tD = hexFetchArray(terrainNormals, d1, d2, d3, dw, 0.0, ddx, ddy) * 2.0 - 1.0;
planar += tD.xy * terrainDetail.w * detailStrength;
float hD = hexFetchArray(terrainRAH, d1, d2, d3, dw, 0.0, ddx, ddy).b;
detailAo = mix(1.0, smoothstep(terrainDetail2.y, terrainDetail2.z, hD), terrainDetail2.x * detailStrength);
}