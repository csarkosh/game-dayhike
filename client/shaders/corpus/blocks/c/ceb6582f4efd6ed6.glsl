const float HALATION_THRESHOLD = 1.0;
const float HALATION_CAP = 4.0;
const vec3 HALATION_TINT = vec3(1.0, 0.45, 0.2);
float halationLuma(vec3 c) {
return dot(c, vec3(0.2126, 0.7152, 0.0722));
}