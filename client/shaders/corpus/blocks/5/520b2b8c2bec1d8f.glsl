layout(set = 1, binding = 38) uniform sampler featureTexSampler;
                        layout(set = 1, binding = 37) uniform texture2D featureTexTexture;
                        #define featureTex sampler2D(featureTexTexture, featureTexSampler)
#define CUSTOM_FRAGMENT_DEFINITIONS
struct albedoOpacityOutParams
{vec3 surfaceAlbedo;
float alpha;
};