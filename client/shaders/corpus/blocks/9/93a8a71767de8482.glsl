// Atmosphere fog, spliced into the PBR fragment by AtmospherePlugin in
// atmosphere.ts at CUSTOM_FRAGMENT_DEFINITIONS and called from the regex
// replacement of Babylon's fog mix line. Plugin custom code is applied after
// include expansion and before conditional evaluation, so nothing here may
// rely on material conditionals: the gate is the atmOn uniform.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The literals below mirror atmosphereParams.ts and a lockstep test asserts
// they agree. Tune them there and here together.
// The gradient sampler is declared here, not in AtmospherePlugin's
// getUniforms().fragment, because that string lands at
// ADDITIONAL_FRAGMENT_DECLARATION, which exists only on the non-uniform-buffer
// path. With UBOs supported, the fragment declaration include resolves to
// pbrUboDeclaration instead, which carries only ADDITIONAL_UBO_DECLARATION,
// and a sampler cannot live in a UBO — so the uniform would silently vanish
// and every PBR fragment shader would fail to compile. This file lands at
// CUSTOM_FRAGMENT_DEFINITIONS on both paths, the terrainTexture.ts precedent
// for the same trap. getSamplers still lists atmGradient, unchanged.
layout(set = 1, binding = 25) uniform sampler atmGradientSampler;
                        layout(set = 1, binding = 24) uniform texture2D atmGradientTexture;
                        #define atmGradient sampler2D(atmGradientTexture, atmGradientSampler)
// Slope below which a ray counts as level, to keep the closed form finite.
const float ATM_LEVEL_SLOPE = 1.0e-3;
// Quilez closed-form height fog: density a*exp(-b*y) integrated along a ray
// of length t from height y0 with vertical slope rdY. Mirrors heightFogAmount
// in atmosphereParams.ts exactly.
float atmHeightFog(float y0, float rdY, float t, float a, float b) {
float slope = abs(rdY) < ATM_LEVEL_SLOPE ? (rdY < 0.0 ? -ATM_LEVEL_SLOPE : ATM_LEVEL_SLOPE) : rdY;
return (a / b) * exp(-y0 * b) * (1.0 - exp(-t * slope * b)) / slope;
}