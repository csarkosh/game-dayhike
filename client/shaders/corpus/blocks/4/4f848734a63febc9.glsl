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