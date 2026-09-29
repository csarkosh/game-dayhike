// The uv to fetch for vertex v: rotate about the vertex, then offset, both hashed.
vec2 hexUv(vec2 uv, vec2 v) {
vec2 vp = (HEX_UNSKEW * v) / HEX_LATTICE;
float a = hexHash(v, 0.0) * HEX_TAU;
float ca = cos(a);
float sa = sin(a);
vec2 d = uv - vp;
vec2 o = vec2(hexHash(v, 7.3), hexHash(v, 13.1));
return vec2(ca * d.x - sa * d.y, sa * d.x + ca * d.y) + o;
}