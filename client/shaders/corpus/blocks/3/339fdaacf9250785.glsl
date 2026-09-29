// Linear sRGB in, linear sRGB in [0, 1] out. Mirrors agx() in gradeParams.ts.
vec3 agxToneMap(vec3 c) {
vec3 v = AGX_INSET * (SRGB_TO_REC2020 * c);
v = max(v, vec3(1.0e-10));
v = (log2(v) - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV);
v = clamp(v, 0.0, 1.0);
v = agxContrast(v);
v = AGX_OUTSET * v;
v = pow(max(v, vec3(0.0)), vec3(2.2));
v = REC2020_TO_SRGB * v;
return clamp(v, 0.0, 1.0);
}