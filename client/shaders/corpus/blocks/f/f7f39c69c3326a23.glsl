layout(location = 0) out vec4 glFragColor;
void main(void) {
vec3 c = texture(textureSampler, vUV).rgb * exposure;
c = agxToneMap(c);
c = clamp(whitePoint * c, 0.0, 1.0);
float l = gradeLuma(c);
float rod = (1.0 - smoothstep(0.0, purkinjeThreshold, l)) * purkinjeStrength;
c = mix(c, purkinje * c, rod);
float shadowMask = 1.0 - smoothstep(0.0, 0.35, l);
float highlightMask = smoothstep(0.55, 1.0, l);
float midMask = 1.0 - shadowMask - highlightMask;
c = gradeBand(c, shadowMask, shadowTint, shadowAmount);
c = gradeBand(c, midMask, midtoneTint, midtoneAmount);
c = gradeBand(c, highlightMask, highlightTint, highlightAmount);
c = mix(vec3(gradeLuma(c)), c, 1.0 + saturation);
c = lift + c * (1.0 - lift);
vec2 centred = (vUV - 0.5) * 2.0;
float vr = length(centred) / 1.41421356;
float vig = 1.0 - smoothstep(0.55, 1.0, vr) * clamp(vignetteWeight * 0.22, 0.0, 0.8);
c = mix(vignetteColour, c, vig);
vec3 halo = texture(halationSampler, vUV).rgb * halationStrength;
c = 1.0 - (1.0 - c) * (1.0 - clamp(halo, 0.0, 1.0));
glFragColor = vec4(toSrgb(clamp(c, 0.0, 1.0)), 1.0);
}