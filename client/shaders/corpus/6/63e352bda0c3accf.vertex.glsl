#version 450
#define IMAGEPROCESSINGPOSTPROCESS

#define SHADER_NAME vertex:sky
layout(set = 1, binding = 1) uniform LeftOver {
        mat4 world;
    mat4 view;
    mat4 viewProjection;
    vec3 cameraPosition;
    vec3 cameraOffset;
    vec3 up;
    float luminance;
    float turbidity;
    float rayleigh;
    float mieCoefficient;
    float mieDirectionalG;
    vec3 sunPosition;
};

// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};
precision highp float;
layout(location = 0) in vec3 position;



layout(location = 0)  out vec3 vPositionW;
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
gl_Position=viewProjection*world*vec4(position,1.0);
vec4 worldPos=world*vec4(position,1.0);
vPositionW=vec3(worldPos);
#define CUSTOM_VERTEX_MAIN_END
gl_Position.y *= yFactor_;
}