// Everything a hex fetch needs that depends on the uv alone: the three hashed
// uvs and the sharpened weights. Nine sin hashes and a lattice walk, so a
// caller sampling several maps at ONE scale calls this once and hands the
// result to as many fetchers as it likes.
void hexSetup(vec2 uv, out vec2 u1, out vec2 u2, out vec2 u3, out vec3 s) {
vec2 v1;
vec2 v2;
vec2 v3;
vec3 w;
hexTriangle(uv, v1, v2, v3, w);
u1 = hexUv(uv, v1);
u2 = hexUv(uv, v2);
u3 = hexUv(uv, v3);
s = hexWeightsSharp(w);
}