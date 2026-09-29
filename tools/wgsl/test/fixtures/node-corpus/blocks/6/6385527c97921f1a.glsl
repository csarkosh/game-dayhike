#define SHADER_NAME fragment:default
precision highp float;
// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};