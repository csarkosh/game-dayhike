float macroValueNoise(vec2 p, float wave) {
vec2 q = p / wave;
vec2 c = floor(q);
vec2 f = smoothstep(0.0, 1.0, q - c);
float a = latticeHash(c);
float b = latticeHash(c + vec2(1.0, 0.0));
float d = latticeHash(c + vec2(0.0, 1.0));
float e = latticeHash(c + vec2(1.0, 1.0));
return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}