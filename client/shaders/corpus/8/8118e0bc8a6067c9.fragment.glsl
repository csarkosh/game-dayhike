#version 450
#define RAIN_HEIGHT_TERRAIN
#define VERTEXCOLOR
#define NUM_BONE_INFLUENCERS 0
#define NUM_MORPH_INFLUENCERS 0
#define FOG
#define SHADER_NAME fragment:rainHeight
layout(set = 1, binding = 1) uniform LeftOver {
        mat4 world;
    mat4 viewProjection;
};

precision highp float;
// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};

layout(location = 1)  in float vHeight;
layout(location = 0)  in float vCanopy;
layout(location = 0) out vec4 glFragColor;
void main(void) {
float transmission = 1.0 - 0.65 * vCanopy;
float lift = 10.0 * step(0.01, vCanopy);
glFragColor = vec4(vHeight, transmission, lift, 1.0);
}
