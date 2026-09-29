#define vAlbedoUV vMainUV1
layout(set = 1, binding = 10) uniform sampler albedoSamplerSampler;
                        layout(set = 1, binding = 9) uniform texture2D albedoSamplerTexture;
                        #define albedoSampler sampler2D(albedoSamplerTexture, albedoSamplerSampler)
#define vReflectivityUV vMainUV1
layout(set = 1, binding = 12) uniform sampler reflectivitySamplerSampler;
                        layout(set = 1, binding = 11) uniform texture2D reflectivitySamplerTexture;
                        #define reflectivitySampler sampler2D(reflectivitySamplerTexture, reflectivitySamplerSampler)
#define sampleReflection(s,c) texture(s,c)
layout(set = 1, binding = 14) uniform sampler reflectionSamplerSampler;
                        layout(set = 1, binding = 13) uniform textureCube reflectionSamplerTexture;
                        #define reflectionSampler samplerCube(reflectionSamplerTexture, reflectionSamplerSampler)
#define sampleReflectionLod(s,c,l) textureLod(s,c,l)
layout(set = 1, binding = 16) uniform sampler environmentBrdfSamplerSampler;
                        layout(set = 1, binding = 15) uniform texture2D environmentBrdfSamplerTexture;
                        #define environmentBrdfSampler sampler2D(environmentBrdfSamplerTexture, environmentBrdfSamplerSampler)
#define FOGMODE_NONE 0.
#define FOGMODE_EXP 1.
#define FOGMODE_EXP2 2.
#define FOGMODE_LINEAR 3.
#define E 2.71828
