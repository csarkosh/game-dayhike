// The figure in the mask, kept where the smoke has it: shadeSmoke.x is how far
// in it is, 0 nothing to 1 whole, through the rising noise, its lower body
// first, the way a figure comes up out of the mist, and its feet always lost
// in the mist. Its edge, where the surface turns from the eye, is frayed by a
// faster noise by shadeSmokeEdge.x, so the outline shifts and is never whole.
#ifdef SHADESMOKE
float shadeSmokeUp = clamp((vPositionW.y - shadeSmoke.z) / max(shadeSmoke.w, 0.01), 0.0, 1.0);
float shadeSmokeN = shadeSmokeFbm(shadeSmokeAt(vPositionW, shadeSmoke.y));
float shadeSmokeCut = 0.75 * shadeSmokeN + 0.25 * shadeSmokeUp;
float shadeSmokeIn = mix(-SHADE_SMOKE_SOFT, 1.0 + SHADE_SMOKE_SOFT, shadeSmoke.x);
float shadeSmokeKeep = smoothstep(shadeSmokeCut - SHADE_SMOKE_SOFT, shadeSmokeCut + SHADE_SMOKE_SOFT, shadeSmokeIn);
float shadeSmokeRim = 1.0 - abs(dot(normalW, viewDirectionW));
float shadeSmokeFray = shadeSmokeFbm(shadeSmokeAt(vPositionW, shadeSmoke.y * 1.7) * 2.0 + vec3(shadeSmoke.y * 0.23, 0.0, shadeSmoke.y * 0.17));
shadeSmokeKeep *= 1.0 - shadeSmokeEdge.x * smoothstep(0.35, 0.9, shadeSmokeRim + (shadeSmokeFray - 0.5) * 0.9);
shadeSmokeKeep *= smoothstep(0.0, SHADE_SMOKE_FEET, shadeSmokeUp);
color.a *= shadeSmokeKeep;
#endif
