#version 450
#define INSTANCES
#define THIN_INSTANCES
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

layout(location = 0)  in float vHeight;
layout(location = 0) out vec4 glFragColor;
void main(void) {
float transmission = 0.0;
float lift = 0.0;
glFragColor = vec4(vHeight, transmission, lift, 1.0);
}
