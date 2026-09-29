vec3 hexWeightsSharp(vec3 w) {
vec3 s = pow(max(w, vec3(0.0)), vec3(HEX_SHARPNESS));
return s / max(s.x + s.y + s.z, 1.0e-9);
}