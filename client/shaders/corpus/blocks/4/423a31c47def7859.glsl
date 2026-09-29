#define DISABLE_UNIFORMITY_ANALYSIS
layout(location = 10)  in vec4 vTerrainW;
layout(location = 11)  in vec4 vTerrainW2;
layout(location = 12)  in float vTerrainCover;
layout(set = 1, binding = 19) uniform sampler terrainGrassSampler;
                        layout(set = 1, binding = 18) uniform texture2D terrainGrassTexture;
                        #define terrainGrass sampler2D(terrainGrassTexture, terrainGrassSampler)
layout(set = 1, binding = 21) uniform sampler terrainFloorSampler;
                        layout(set = 1, binding = 20) uniform texture2D terrainFloorTexture;
                        #define terrainFloor sampler2D(terrainFloorTexture, terrainFloorSampler)
layout(set = 1, binding = 23) uniform sampler terrainRockSampler;
                        layout(set = 1, binding = 22) uniform texture2D terrainRockTexture;
                        #define terrainRock sampler2D(terrainRockTexture, terrainRockSampler)
layout(set = 1, binding = 25) uniform sampler terrainSandSampler;
                        layout(set = 1, binding = 24) uniform texture2D terrainSandTexture;
                        #define terrainSand sampler2D(terrainSandTexture, terrainSandSampler)
layout(set = 1, binding = 27) uniform sampler terrainPebbleSampler;
                        layout(set = 1, binding = 26) uniform texture2D terrainPebbleTexture;
                        #define terrainPebble sampler2D(terrainPebbleTexture, terrainPebbleSampler)
// highp is required, not decorative: GLSL ES 3.00 has no default fragment
// precision for sampler2DArray, so omitting it is a compile error on real
// WebGL2 ("'sampler2DArray' : No precision specified") that NullEngine's
// string-only preprocessor can never see. Babylon's own array-sampler code
// uses highp for the same reason.
layout(set = 1, binding = 29) uniform sampler terrainNormalsSampler;
                        layout(set = 1, binding = 28) uniform texture2DArray terrainNormalsTexture;
                        #define terrainNormals sampler2DArray(terrainNormalsTexture, terrainNormalsSampler)
layout(set = 1, binding = 31) uniform sampler terrainRAHSampler;
                        layout(set = 1, binding = 30) uniform texture2DArray terrainRAHTexture;
                        #define terrainRAH sampler2DArray(terrainRAHTexture, terrainRAHSampler)
// The grass floor's GLSL: hex tiling (a triangular lattice over the texture
// repeat, three samples at hashed offsets and rotations, sharpened weights),
// the lattice hash and the two-octave macro noise the lush/dry tint rides on,
// and the horizon tint's weight. Spliced by TerrainTexturePlugin at
// CUSTOM_FRAGMENT_DEFINITIONS after its own uniform declarations, so the
// functions below may read terrainHorizon. Every constant mirrors
// groundHexParams.ts and a lockstep test asserts they agree.
//
// The hex offsets use a sin hash that only the GPU evaluates. The macro noise
// uses the multiply-add-fract lattice hash the CPU mirrors exactly, because the
// tufts sample the same tint on the CPU and must agree with the floor.
//
// Samples take explicit gradients of the UNROTATED uv, so a hex seam changes
// the texel fetched but not the mip level, and no seam shows as a blur line.
//
// hexSample2D and hexSampleArray have no caller in the plugin: it sets the
// lattice up once per scale with hexSetup and fetches through hexFetch2D and
// hexFetchArray. They are kept as the one-shot spelling the lockstep tests
// name, and as the obvious entry point for a lone sample.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.
const float HEX_LATTICE = 1.0;
const float HEX_SHARPNESS = 8.0;
const mat2 HEX_SKEW = mat2(1.0, 0.0, -0.57735027, 1.15470054);
const mat2 HEX_UNSKEW = mat2(1.0, 0.0, 0.5, 0.8660254);
const vec2 MACRO_WAVE = vec2(18.0, 6.0);
const vec2 MACRO_WEIGHT = vec2(0.65, 0.35);
const float MACRO_SLOPE = 0.6;
const vec3 MACRO_LUSH = vec3(0.82, 1.06, 0.84);
const vec3 MACRO_DRY = vec3(1.18, 0.98, 0.7);
const float HEX_TAU = 6.28318531;
// GPU-only: offsets and rotations per lattice vertex. Not mirrored.
float hexHash(vec2 v, float salt) {
return fract(sin(dot(v + salt, vec2(127.1, 311.7))) * 43758.5453);
}