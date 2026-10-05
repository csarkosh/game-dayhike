#version 450
#define INSTANCES
#define THIN_INSTANCES
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
layout(location = 1) in vec4 world0;
layout(location = 2) in vec4 world1;
layout(location = 3) in vec4 world2;
layout(location = 4) in vec4 world3;


layout(location = 0)  out float vHeight;
void main(void) {
mat4 finalWorld=mat4(world0,world1,world2,world3);
finalWorld=world*finalWorld;
vec4 worldPos = finalWorld * vec4(position, 1.0);
vHeight = worldPos.y;
gl_Position = viewProjection * worldPos;
gl_Position.y *= yFactor_;
}