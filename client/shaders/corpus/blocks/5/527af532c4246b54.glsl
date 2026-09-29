{
vec4 fMeta = texture(featureTex, vec2(0.5 / 4.0, 0.75));
vec4 fRim = texture(featureTex, vec2(1.5 / 4.0, 0.75));
for (int fi = 0;
fi < 4;
fi++) {
if (float(fi) >= featureInfo.x) break;
vec4 f = texture(featureTex, vec2((float(fi) + 0.5) / 4.0, 0.25));
float fd = length(vPositionW.xz - f.xy);
if (f.w > 1.5 && f.w < 2.5) {
float meadow = 1.0 - smoothstep(f.z, f.z + fMeta.z, fd);
surfaceAlbedo *= mix(vec3(1.0), vec3(0.92, 1.06, 0.82), meadow * 0.5);
} else if (f.w > 2.5) {