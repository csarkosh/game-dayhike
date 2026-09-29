layout(set = 1, binding = 33) uniform sampler roadCenterSampler;
                        layout(set = 1, binding = 32) uniform texture2D roadCenterTexture;
                        #define roadCenter sampler2D(roadCenterTexture, roadCenterSampler)
layout(set = 1, binding = 35) uniform sampler roadAsphaltSampler;
                        layout(set = 1, binding = 34) uniform texture2D roadAsphaltTexture;
                        #define roadAsphalt sampler2D(roadAsphaltTexture, roadAsphaltSampler)
layout(set = 1, binding = 37) uniform sampler trailIndexSampler;
                        layout(set = 1, binding = 36) uniform texture2D trailIndexTexture;
                        #define trailIndex sampler2D(trailIndexTexture, trailIndexSampler)
layout(set = 1, binding = 39) uniform sampler trailSegsSampler;
                        layout(set = 1, binding = 38) uniform texture2D trailSegsTexture;
                        #define trailSegs sampler2D(trailSegsTexture, trailSegsSampler)
float trailValueNoise1(float u, float wave) {
float q = u / wave;
float c = floor(q);
float f = smoothstep(0.0, 1.0, q - c);
return mix(latticeHash(vec2(c, 0.0)), latticeHash(vec2(c + 1.0, 0.0)), f);
}