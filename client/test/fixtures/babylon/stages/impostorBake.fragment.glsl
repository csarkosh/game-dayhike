// The game's shell on Babylon.js 9.18.0: IMPOSTOR_BAKE_FRAGMENT (impostorBakePlugin.ts)

#ifdef IMPOSTORBAKE
if (bakeMode > 1.5) {
vec3 bakeN = normalize(normalW);
finalColor = vec4(vec3(bakeN.x, bakeN.y, -bakeN.z) * 0.5 + 0.5, alpha);
} else if (bakeMode > 0.5) {
finalColor = vec4(toGammaSpace(surfaceAlbedo), alpha);
}
#endif
