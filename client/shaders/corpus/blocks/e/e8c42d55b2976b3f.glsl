// Halation extract: quarter-resolution first stage of the halation chain in
// post.ts, run on the EXPOSED linear scene before the grade pass's tone map.
// Keeps only what is brighter than HALATION_THRESHOLD in exposed linear
// luminance — brighter than display white before the tone map rolls it off —
// tinted toward the red-orange bleed film shows around lights. The response
// saturates at HALATION_CAP over threshold so a very bright source (a raw
// linear luma that can run into the hundreds) cannot blow the half-float
// render target to Inf, which the blur would then spread into solid white.
// The two BlurPostProcess stages that follow are Babylon's own.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose. The literals mirror
// postParams.ts and a lockstep test asserts they agree.
precision highp float;
layout(location = 0)  in vec2 vUV;
layout(set = 1, binding = 2) uniform sampler textureSamplerSampler;
                        layout(set = 1, binding = 1) uniform texture2D textureSamplerTexture;
                        #define textureSampler sampler2D(textureSamplerTexture, textureSamplerSampler)
