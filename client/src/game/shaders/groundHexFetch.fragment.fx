// One hex-tiled fetch of a 2D texture from a prepared lattice. dx, dy are the
// gradients of the plain uv.
vec3 hexFetch2D(sampler2D tex, vec2 u1, vec2 u2, vec2 u3, vec3 s, vec2 dx, vec2 dy) {
  return textureGrad(tex, u1, dx, dy).rgb * s.x
       + textureGrad(tex, u2, dx, dy).rgb * s.y
       + textureGrad(tex, u3, dx, dy).rgb * s.z;
}

// The same for one layer of a 2D array (the relief maps).
vec3 hexFetchArray(highp sampler2DArray tex, vec2 u1, vec2 u2, vec2 u3, vec3 s, float layer, vec2 dx, vec2 dy) {
  return textureGrad(tex, vec3(u1, layer), dx, dy).rgb * s.x
       + textureGrad(tex, vec3(u2, layer), dx, dy).rgb * s.y
       + textureGrad(tex, vec3(u3, layer), dx, dy).rgb * s.z;
}

// The one-shot spellings: lattice and fetch together, for a lone sample.
vec3 hexSample2D(sampler2D tex, vec2 uv, vec2 dx, vec2 dy) {
  vec2 u1; vec2 u2; vec2 u3; vec3 s;
  hexSetup(uv, u1, u2, u3, s);
  return hexFetch2D(tex, u1, u2, u3, s, dx, dy);
}

vec3 hexSampleArray(highp sampler2DArray tex, vec2 uv, float layer, vec2 dx, vec2 dy) {
  vec2 u1; vec2 u2; vec2 u3; vec3 s;
  hexSetup(uv, u1, u2, u3, s);
  return hexFetchArray(tex, u1, u2, u3, s, layer, dx, dy);
}

