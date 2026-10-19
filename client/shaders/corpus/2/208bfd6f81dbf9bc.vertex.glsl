#version 450
#define SHADER_NAME vertex:postprocess
layout(set = 1, binding = 7) uniform LeftOver {
        vec2 scale;
    vec2 texel;
    vec3 soft;
    vec3 farEye;
    vec3 farForward;
    vec3 farRight;
    vec3 farUp;
    vec3 atmSunDir;
    vec3 atmSunColour;
    float atmCloudDensity;
    float atmCloudSteps;
    float atmCloudRange;
    float atmCloudFalloff;
    float atmCloudSeat;
    float atmCloudGroundRange;
    float atmCloudNear;
    float atmCloudTrail;
    vec2 atmCloudNoiseScale;
    vec2 atmCloudWind;
    vec2 atmCloudGlow;
    vec3 atmCloudColour;
    vec4 atmCloudGroundRect;
};

precision highp float;
// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};
layout(location = 0) in vec2 position;

layout(location = 0)  out vec2 vUV;
const vec2 madd=vec2(0.5,0.5);
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
vUV=(position*madd+madd)*scale;
gl_Position=vec4(position,0.0,1.0);
#define CUSTOM_VERTEX_MAIN_END
gl_Position.y *= yFactor_;
}