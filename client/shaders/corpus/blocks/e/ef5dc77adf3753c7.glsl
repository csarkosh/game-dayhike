#define vAlbedoUV vMainUV1
layout(set = 1, binding = 11) uniform sampler albedoSamplerSampler;
                        layout(set = 1, binding = 10) uniform texture2D albedoSamplerTexture;
                        #define albedoSampler sampler2D(albedoSamplerTexture, albedoSamplerSampler)
#define vAmbientUV vMainUV1
layout(set = 1, binding = 13) uniform sampler ambientSamplerSampler;
                        layout(set = 1, binding = 12) uniform texture2D ambientSamplerTexture;
                        #define ambientSampler sampler2D(ambientSamplerTexture, ambientSamplerSampler)
#define vReflectivityUV vMainUV1
layout(set = 1, binding = 15) uniform sampler reflectivitySamplerSampler;
                        layout(set = 1, binding = 14) uniform texture2D reflectivitySamplerTexture;
                        #define reflectivitySampler sampler2D(reflectivitySamplerTexture, reflectivitySamplerSampler)
#define sampleReflection(s,c) texture(s,c)
layout(set = 1, binding = 17) uniform sampler reflectionSamplerSampler;
                        layout(set = 1, binding = 16) uniform textureCube reflectionSamplerTexture;
                        #define reflectionSampler samplerCube(reflectionSamplerTexture, reflectionSamplerSampler)
#define sampleReflectionLod(s,c,l) textureLod(s,c,l)
layout(set = 1, binding = 19) uniform sampler environmentBrdfSamplerSampler;
                        layout(set = 1, binding = 18) uniform texture2D environmentBrdfSamplerTexture;
                        #define environmentBrdfSampler sampler2D(environmentBrdfSamplerTexture, environmentBrdfSamplerSampler)
#define FOGMODE_NONE 0.
#define FOGMODE_EXP 1.
#define FOGMODE_EXP2 2.
#define FOGMODE_LINEAR 3.
#define E 2.71828
