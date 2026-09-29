layout(location = 0) out vec4 glFragColor;
void main(void) {
vec3 exposed = texture(textureSampler, vUV).rgb * exposure;
float l = halationLuma(exposed);
float over = clamp(l - HALATION_THRESHOLD, 0.0, HALATION_CAP) / HALATION_CAP;
glFragColor = vec4(exposed / max(l, 1.0e-4) * HALATION_TINT * over, 1.0);
}