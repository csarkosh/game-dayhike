vec3 agxContrast(vec3 x) {
vec3 x2 = x * x;
vec3 x4 = x2 * x2;
return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}