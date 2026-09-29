// slope is 1 minus the ground normal's y. Mirrors macroTint in groundHexParams.ts.
vec3 macroTint(float noise, float slope) {
float m = clamp(noise + MACRO_SLOPE * clamp(slope, 0.0, 1.0), 0.0, 1.0);
return mix(MACRO_LUSH, MACRO_DRY, m);
}