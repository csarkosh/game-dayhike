#version 450
#define SHADER_NAME vertex:postprocess
layout(set = 1, binding = 3) uniform LeftOver {
        vec2 scale;
    vec2 texelSize;
    float overlapGain;
    float overlapPhase;
    float grainGain;
    float time;
};