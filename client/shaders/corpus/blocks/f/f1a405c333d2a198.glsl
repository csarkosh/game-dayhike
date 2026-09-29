#define sampleReflection(s,c) texture(s,c)
layout(set = 1, binding = 7) uniform sampler reflectionSamplerSampler;
                        layout(set = 1, binding = 6) uniform textureCube reflectionSamplerTexture;
                        #define reflectionSampler samplerCube(reflectionSamplerTexture, reflectionSamplerSampler)
#define sampleReflectionLod(s,c,l) textureLod(s,c,l)
layout(set = 1, binding = 9) uniform sampler environmentBrdfSamplerSampler;
                        layout(set = 1, binding = 8) uniform texture2D environmentBrdfSamplerTexture;
                        #define environmentBrdfSampler sampler2D(environmentBrdfSamplerTexture, environmentBrdfSamplerSampler)
#define FOGMODE_NONE 0.
#define FOGMODE_EXP 1.
#define FOGMODE_EXP2 2.
#define FOGMODE_LINEAR 3.
#define E 2.71828
