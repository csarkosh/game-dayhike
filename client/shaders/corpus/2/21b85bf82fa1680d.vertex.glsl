#version 450
#define RAIN_HEIGHT_WATER
#define NUM_BONE_INFLUENCERS 0
#define NUM_MORPH_INFLUENCERS 0
#define FOG
#define SHADER_NAME vertex:rainHeight
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
layout(location = 0) in vec3 position;


layout(location = 0)  out float vHeight;
void main(void) {
mat4 finalWorld=world;
vec4 worldPos = finalWorld * vec4(position, 1.0);
vHeight = worldPos.y;
gl_Position = viewProjection * worldPos;
gl_Position.y *= yFactor_;
}