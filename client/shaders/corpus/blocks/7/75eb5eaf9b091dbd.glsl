#define vOpacityUV vMainUV1
layout(set = 1, binding = 4) uniform sampler opacitySamplerSampler;
                        layout(set = 1, binding = 3) uniform texture2D opacitySamplerTexture;
                        #define opacitySampler sampler2D(opacitySamplerTexture, opacitySamplerSampler)
#define CUSTOM_IMAGEPROCESSINGFUNCTIONS_DEFINITIONS
vec4 applyImageProcessing(vec4 result) {
#define CUSTOM_IMAGEPROCESSINGFUNCTIONS_UPDATERESULT_ATSTART
result.rgb=toGammaSpace(result.rgb);
result.rgb=saturate(result.rgb);
#define CUSTOM_IMAGEPROCESSINGFUNCTIONS_UPDATERESULT_ATEND
return result;
}