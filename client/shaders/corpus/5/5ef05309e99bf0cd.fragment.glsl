#version 450
#define SHADER_NAME fragment:paintCompose
layout(set = 1, binding = 5) uniform LeftOver {
        vec2 scale;
    vec2 halfTexel;
    float strength;
};

// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};

// The paint's compose (2026-10-18): the strokes, painted at half the
// frame's pixels on each axis (paint.fragment.fx), brought back over the
// frame at full and mixed with the scene by the paint's strength. Each full
// pixel takes the four painted texels round it, weighted as a bilinear
// upscale would and, besides, by how near the scene at each texel's centre
// is to the scene at the pixel: a joint bilateral upsample, the frame's own
// colour the guide. An edge so stays on its side of the pixel instead of
// smearing a painted texel wide, which a plain upscale did to every blade
// and post. The scene at a texel's centre is a bilinear read of the full
// frame there, the 2 by 2 average the paint itself read.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose. Literals mirror
// postParams.ts and a lockstep test asserts they agree.
precision highp float;
layout(location = 0)  in vec2 vUV;
layout(set = 1, binding = 2) uniform sampler textureSamplerSampler;
                        layout(set = 1, binding = 1) uniform texture2D textureSamplerTexture;
                        #define textureSampler sampler2D(textureSamplerTexture, textureSamplerSampler)
layout(set = 1, binding = 4) uniform sampler sceneSamplerSampler;
                        layout(set = 1, binding = 3) uniform texture2D sceneSamplerTexture;
                        #define sceneSampler sampler2D(sceneSamplerTexture, sceneSamplerSampler)


const float PAINT_CAP = 64.0;
const float PAINT_JOINT_SHARPNESS = 60.0;
vec3 composeCompress(vec3 c) {
return c / (1.0 + c);
}
vec3 composeScene(vec2 uv) {
return clamp(textureLod(sceneSampler, uv, 0.0).rgb, vec3(0.0), vec3(PAINT_CAP));
}
float composeWeight(float bilinear, vec3 at, vec3 guide) {
vec3 d = composeCompress(at) - guide;
return bilinear * exp(-PAINT_JOINT_SHARPNESS * dot(d, d)) + 1.0e-5;
}
layout(location = 0) out vec4 glFragColor;
void main(void) {
vec3 scene = composeScene(vUV);
vec3 guide = composeCompress(scene);
vec2 p = vUV / halfTexel - 0.5;
vec2 base = floor(p);
vec2 f = p - base;
vec2 c00 = (base + vec2(0.5, 0.5)) * halfTexel;
vec2 c10 = (base + vec2(1.5, 0.5)) * halfTexel;
vec2 c01 = (base + vec2(0.5, 1.5)) * halfTexel;
vec2 c11 = (base + vec2(1.5, 1.5)) * halfTexel;
float w00 = composeWeight((1.0 - f.x) * (1.0 - f.y), composeScene(c00), guide);
float w10 = composeWeight(f.x * (1.0 - f.y), composeScene(c10), guide);
float w01 = composeWeight((1.0 - f.x) * f.y, composeScene(c01), guide);
float w11 = composeWeight(f.x * f.y, composeScene(c11), guide);
vec3 painted = (textureLod(textureSampler, c00, 0.0).rgb * w00 + textureLod(textureSampler, c10, 0.0).rgb * w10
+ textureLod(textureSampler, c01, 0.0).rgb * w01 + textureLod(textureSampler, c11, 0.0).rgb * w11) / (w00 + w10 + w01 + w11);
glFragColor = vec4(mix(scene, painted, strength), 1.0);
}
