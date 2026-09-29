#define SHADER_NAME vertex:pbr
// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};