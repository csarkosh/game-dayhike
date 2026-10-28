#version 450
#define SHADER_NAME fragment:taa
layout(set = 1, binding = 7) uniform LeftOver {
        vec2 scale;
    vec2 texel;
    vec3 taaEye;
    vec3 taaForward;
    vec3 taaRight;
    vec3 taaUp;
    vec3 taaPrevEye;
    vec3 taaPrevForward;
    vec3 taaPrevRight;
    vec3 taaPrevUp;
    vec3 taaParams;
};

// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};

// Temporal anti-aliasing (post.ts, 2026-10-28). The scene is drawn each
// frame with the camera moved by a fraction of a pixel along a Halton walk,
// and this pass blends the frame into the history of the frames before it,
// so a pixel over a distant crown averages many samples of it instead of
// jumping between needle and sky as the view moves.
//
// The history is found where this pixel's point was last frame: the point
// is rebuilt from the prepass's camera-space depth on the camera's ray
// through the pixel (as farSoft.fragment.fx builds it), then projected with
// the last frame's camera. A depth of 0 (the sky dome, which draws to one
// target) is taken as a direction. That is exact for anything that does not
// move by itself; what does (swaying leaves, animals) is held to the colours
// round the pixel this frame: the history is clipped toward the box of its
// 3x3 neighbourhood in YCoCg, narrowed by the neighbourhood's spread, so a
// stale colour cannot trail behind. The history is read with a five-tap
// Catmull-Rom so it stays sharp over many frames, and blended in linear
// light, so a flickering speck settles at its mean brightness.
//
// Every read is at an explicit level: WGSL allows an implicit-level sample
// only in uniform control flow.
precision highp float;
layout(location = 0)  in vec2 vUV;
layout(set = 1, binding = 2) uniform sampler textureSamplerSampler;
                        layout(set = 1, binding = 1) uniform texture2D textureSamplerTexture;
                        #define textureSampler sampler2D(textureSamplerTexture, textureSamplerSampler)
layout(set = 1, binding = 4) uniform sampler historySamplerSampler;
                        layout(set = 1, binding = 3) uniform texture2D historySamplerTexture;
                        #define historySampler sampler2D(historySamplerTexture, historySamplerSampler)
layout(set = 1, binding = 6) uniform sampler depthSamplerSampler;
                        layout(set = 1, binding = 5) uniform texture2D depthSamplerTexture;
                        #define depthSampler sampler2D(depthSamplerTexture, depthSamplerSampler)










vec3 taaToYCoCg(vec3 c) {
return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
}
vec3 taaFromYCoCg(vec3 c) {
return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}
vec3 taaHistory(vec2 uv) {
vec2 pos = uv / texel;
vec2 tc1 = floor(pos - 0.5) + 0.5;
vec2 f = pos - tc1;
vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
vec2 w3 = f * f * (-0.5 + 0.5 * f);
vec2 w12 = w1 + w2;
vec2 tc0 = (tc1 - 1.0) * texel;
vec2 tc3 = (tc1 + 2.0) * texel;
vec2 tc12 = (tc1 + w2 / w12) * texel;
vec3 r = textureLod(historySampler, vec2(tc12.x, tc0.y), 0.0).rgb * (w12.x * w0.y)
+ textureLod(historySampler, vec2(tc0.x, tc12.y), 0.0).rgb * (w0.x * w12.y)
+ textureLod(historySampler, tc12, 0.0).rgb * (w12.x * w12.y)
+ textureLod(historySampler, vec2(tc3.x, tc12.y), 0.0).rgb * (w3.x * w12.y)
+ textureLod(historySampler, vec2(tc12.x, tc3.y), 0.0).rgb * (w12.x * w3.y);
float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
return max(r / wsum, vec3(0.0));
}
vec3 taaClip(vec3 p, vec3 lo, vec3 hi) {
vec3 centre = 0.5 * (hi + lo);
vec3 extent = 0.5 * (hi - lo) + 1.0e-5;
vec3 v = p - centre;
vec3 u = abs(v / extent);
float m = max(u.x, max(u.y, u.z));
return m > 1.0 ? centre + v / m : p;
}
layout(location = 0) out vec4 glFragColor;
void main(void) {
vec4 cur = textureLod(textureSampler, vUV, 0.0);
vec3 m1 = vec3(0.0);
vec3 m2 = vec3(0.0);
vec3 nmin = vec3(1.0e9);
vec3 nmax = vec3(-1.0e9);
for (int y = -1;
y <= 1;
y++) {
for (int x = -1;
x <= 1;
x++) {
vec3 s = taaToYCoCg(textureLod(textureSampler, vUV + vec2(float(x), float(y)) * texel, 0.0).rgb);
m1 += s;
m2 += s * s;
nmin = min(nmin, s);
nmax = max(nmax, s);
}
}
vec3 mean = m1 / 9.0;
vec3 sigma = sqrt(max(m2 / 9.0 - mean * mean, vec3(0.0)));
vec3 lo = max(nmin, mean - taaParams.y * sigma);
vec3 hi = min(nmax, mean + taaParams.y * sigma);
float d = textureLod(depthSampler, vUV, 0.0).r;
vec2 ndc = vUV * 2.0 - 1.0;
vec3 ray = taaForward + ndc.x * taaRight + ndc.y * taaUp;
vec3 v = d > 0.0 ? taaEye + ray * d - taaPrevEye : ray;
float z = dot(v, taaPrevForward);
vec2 pndc = vec2(dot(v, taaPrevRight) / dot(taaPrevRight, taaPrevRight), dot(v, taaPrevUp) / dot(taaPrevUp, taaPrevUp)) / max(z, 1.0e-4);
vec2 puv = pndc * 0.5 + 0.5;
float ok = taaParams.z * step(1.0e-4, z) * step(0.0, puv.x) * step(puv.x, 1.0) * step(0.0, puv.y) * step(puv.y, 1.0);
vec3 hist = taaFromYCoCg(taaClip(taaToYCoCg(taaHistory(clamp(puv, vec2(0.0), vec2(1.0)))), lo, hi));
vec3 blended = mix(hist, cur.rgb, taaParams.x);
glFragColor = vec4(mix(cur.rgb, blended, ok), cur.a);
}
