// The grade pass: the whole colour identity in one full-screen shader, run
// on linear HDR before the pipeline's chromatic aberration and FXAA. Order:
// exposure, AgX, white point, Purkinje, split-tone, global saturation, lift
// (a colour: under dread the shadows go milky green-grey), vignette,
// halation, sRGB encode. Every knob is a uniform from gradeRecordUnder in
// gradeParams.ts, so nothing recompiles at runtime.
//
// The AgX tone map is ported from three.js, MIT License, Copyright 2010-2024 three.js authors
// (src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js).
// Its matrices are column-major and mirrored in gradeParams.ts; a lockstep
// test asserts they agree.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.
precision highp float;
layout(location = 0)  in vec2 vUV;
layout(set = 1, binding = 2) uniform sampler textureSamplerSampler;
                        layout(set = 1, binding = 1) uniform texture2D textureSamplerTexture;
                        #define textureSampler sampler2D(textureSamplerTexture, textureSamplerSampler)
layout(set = 1, binding = 4) uniform sampler halationSamplerSampler;
                        layout(set = 1, binding = 3) uniform texture2D halationSamplerTexture;
                        #define halationSampler sampler2D(halationSamplerTexture, halationSamplerSampler)
