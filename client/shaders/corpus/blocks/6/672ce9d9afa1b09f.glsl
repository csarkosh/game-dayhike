#define DISABLE_UNIFORMITY_ANALYSIS
// The finish pass, last on the camera after the pipeline's chromatic
// aberration and FXAA: the peripheral overlap, luminance-weighted grain and
// a triangular dither, on display-referred sRGB. Every knob is a uniform
// from finishUnder in postParams.ts.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose. Literals mirror
// postParams.ts and a lockstep test asserts they agree.
precision highp float;
layout(location = 0)  in vec2 vUV;
layout(set = 1, binding = 2) uniform sampler textureSamplerSampler;
                        layout(set = 1, binding = 1) uniform texture2D textureSamplerTexture;
                        #define textureSampler sampler2D(textureSamplerTexture, textureSamplerSampler)
