vec3 foliageDiffuseLighting(preLightingInfo info, vec3 lightColor, float lightIndex, float h, vec3 viewDir) {
if (lightIndex > 0.5) {
return computeDiffuseLighting(info, lightColor);
}