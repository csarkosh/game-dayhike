// The lattice triangle the uv falls in: three integer vertices in skewed
// space and their barycentric weights. Mirrors hexTriangle in groundHexParams.ts.
void hexTriangle(vec2 uv, out vec2 v1, out vec2 v2, out vec2 v3, out vec3 w) {
vec2 s = HEX_SKEW * (uv * HEX_LATTICE);
vec2 b = floor(s);
vec2 f = s - b;
if (f.x + f.y < 1.0) {
v1 = b;
v2 = b + vec2(1.0, 0.0);
v3 = b + vec2(0.0, 1.0);
w = vec3(1.0 - f.x - f.y, f.x, f.y);
} else {