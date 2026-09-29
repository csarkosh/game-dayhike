// One split-tone band: pushes the colour toward the tint by density and
// scales its saturation by (1 + saturation), weighted by the band mask.
vec3 gradeBand(vec3 c, float mask, vec3 tintColour, vec2 amount) {
float l = gradeLuma(c);
vec3 tinted = mix(c, tintColour * l, amount.x * SPLIT_TONE_DENSITY_SCALE);
vec3 grey = vec3(gradeLuma(tinted));
vec3 sat = mix(grey, tinted, 1.0 + amount.y * SPLIT_TONE_SATURATION_SCALE);
return mix(c, sat, mask);
}