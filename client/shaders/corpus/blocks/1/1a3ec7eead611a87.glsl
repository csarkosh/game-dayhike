#define FRESNEL_MAXIMUM_ON_ROUGH 0.25
#define BRDF_DIFFUSE_MODEL_EON 0
#define BRDF_DIFFUSE_MODEL_BURLEY 1
#define BRDF_DIFFUSE_MODEL_LAMBERT 2
#define BRDF_DIFFUSE_MODEL_LEGACY 3
#define DIELECTRIC_SPECULAR_MODEL_GLTF 0
#define DIELECTRIC_SPECULAR_MODEL_OPENPBR 1
#define CONDUCTOR_SPECULAR_MODEL_GLTF 0
#define CONDUCTOR_SPECULAR_MODEL_OPENPBR 1
layout(location = 2) in vec4 matricesIndices;
layout(location = 3) in vec4 matricesWeights;
layout(set = 1, binding = 4) uniform sampler boneSamplerSampler;
                        layout(set = 1, binding = 3) uniform texture2D boneSamplerTexture;
                        #define boneSampler sampler2D(boneSamplerTexture, boneSamplerSampler)
