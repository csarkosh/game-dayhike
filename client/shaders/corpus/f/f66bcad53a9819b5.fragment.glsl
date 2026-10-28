#version 450
#define SHADER_NAME fragment:taaSharpen
layout(set = 1, binding = 3) uniform LeftOver {
        vec2 scale;
    vec2 texel;
    float sharpen;
};

// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};

// The temporal anti-aliasing's sharpen (post.ts, 2026-10-28): the TAA's
// output copied on down the chain with the detail its history blending
// softened lifted back, an unsharp mask on the four neighbours held inside
// their range so no edge rings. The TAA's history keeps the unsharpened
// frame, so the lift never builds up from frame to frame.
precision highp float;
layout(location = 0)  in vec2 vUV;
layout(set = 1, binding = 2) uniform sampler textureSamplerSampler;
                        layout(set = 1, binding = 1) uniform texture2D textureSamplerTexture;
                        #define textureSampler sampler2D(textureSamplerTexture, textureSamplerSampler)


layout(location = 0) out vec4 glFragColor;
void main(void) {
vec4 c = textureLod(textureSampler, vUV, 0.0);
vec3 n = textureLod(textureSampler, vUV + vec2(0.0, texel.y), 0.0).rgb;
vec3 s = textureLod(textureSampler, vUV - vec2(0.0, texel.y), 0.0).rgb;
vec3 e = textureLod(textureSampler, vUV + vec2(texel.x, 0.0), 0.0).rgb;
vec3 w = textureLod(textureSampler, vUV - vec2(texel.x, 0.0), 0.0).rgb;
vec3 lo = min(c.rgb, min(min(n, s), min(e, w)));
vec3 hi = max(c.rgb, max(max(n, s), max(e, w)));
vec3 lifted = c.rgb + sharpen * (c.rgb - 0.25 * (n + s + e + w));
glFragColor = vec4(clamp(lifted, lo, hi), c.a);
}
