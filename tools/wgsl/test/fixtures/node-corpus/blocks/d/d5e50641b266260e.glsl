layout(location = 0) out vec4 glFragColor;
void main(void) {
vec3 c = texture(textureSampler, vUV).rgb;
vec2 centred = (vUV - 0.5) * 2.0;
float radius = length(centred) / 1.41421356;
float mask = smoothstep(OVERLAP_INNER, 1.0, radius) * overlapGain;
if (mask > 0.0) {
float breath = 0.01 * sin(overlapPhase * TWO_PI);
vec2 mirrored = vec2(1.0 - vUV.x, vUV.y);
vec2 echoUv = (mirrored - 0.5) / OVERLAP_SCALE + 0.5 + vec2(breath, 0.0);
vec3 echo = texture(textureSampler, clamp(echoUv, 0.0, 1.0)).rgb;
vec3 delit = vec3(finishLuma(echo)) * OVERLAP_ECHO;
c = 1.0 - (1.0 - c) * (1.0 - delit * mask);
}