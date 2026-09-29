layout(set = 1, binding = 30) uniform sampler roadCenterSampler;
                        layout(set = 1, binding = 29) uniform texture2D roadCenterTexture;
                        #define roadCenter sampler2D(roadCenterTexture, roadCenterSampler)
layout(set = 1, binding = 32) uniform sampler roadAsphaltSampler;
                        layout(set = 1, binding = 31) uniform texture2D roadAsphaltTexture;
                        #define roadAsphalt sampler2D(roadAsphaltTexture, roadAsphaltSampler)
layout(set = 1, binding = 34) uniform sampler trailIndexSampler;
                        layout(set = 1, binding = 33) uniform texture2D trailIndexTexture;
                        #define trailIndex sampler2D(trailIndexTexture, trailIndexSampler)
layout(set = 1, binding = 36) uniform sampler trailSegsSampler;
                        layout(set = 1, binding = 35) uniform texture2D trailSegsTexture;
                        #define trailSegs sampler2D(trailSegsTexture, trailSegsSampler)
float trailValueNoise1(float u, float wave) {
float q = u / wave;
float c = floor(q);
float f = smoothstep(0.0, 1.0, q - c);
return mix(latticeHash(vec2(c, 0.0)), latticeHash(vec2(c + 1.0, 0.0)), f);
}