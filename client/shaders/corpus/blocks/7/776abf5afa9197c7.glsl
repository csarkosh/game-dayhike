// Replaces the per-light diffuse term on skin texels. `base` is what Babylon
// computed (BRDF * attenuation * NdotL * lightColor); the wrapped term
// re-expresses it with Lambert so it stays independent of the diffuse model,
// and the scatter adds the red glow only where the light grazes the surface.
// mask at or below 0.001, or skinOn below 0.5, is a pass-through.
vec3 skinDiffuseLighting(preLightingInfo info, vec3 lightColor, float mask) {
vec3 base = computeDiffuseLighting(info, lightColor);
if (skinOn < 0.5 || mask <= 0.001) {
return base;
}