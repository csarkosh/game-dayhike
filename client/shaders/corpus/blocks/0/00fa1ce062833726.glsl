#define hexFetch2D(tex, u1, u2, u3, s, dx, dy) (textureGrad(tex, u1, dx, dy).rgb * (s).x + textureGrad(tex, u2, dx, dy).rgb * (s).y + textureGrad(tex, u3, dx, dy).rgb * (s).z)
#define hexFetchArray(tex, u1, u2, u3, s, layer, dx, dy) (textureGrad(tex, vec3(u1, layer), dx, dy).rgb * (s).x + textureGrad(tex, vec3(u2, layer), dx, dy).rgb * (s).y + textureGrad(tex, vec3(u3, layer), dx, dy).rgb * (s).z)
// Mirrored exactly by latticeHash in groundHexParams.ts.
float latticeHash(vec2 c) {
return fract(0.618034 * c.x + 0.381966 * c.y + 0.0113 * c.x * c.y);
}