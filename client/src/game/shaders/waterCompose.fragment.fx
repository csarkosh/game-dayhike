// Water plugin, before the final colour composition: the bed's light through
// the surface on the high tier (zero elsewhere), added as emissive so fog and
// the colour path apply to it as to the rest of the surface.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
#ifndef OCEAN
#ifdef REFLECTION
// The lake's mirror (lakeMirror.fragment.fx): where the target drew the
// shore, its image takes the place of the sky probe's radiance, through
// PBR's own Fresnel, by the state's weight, the glass's share of the lake
// and the cat's-paws, and by the share of the reads that met the shore.
// Before the skin, which then holds it off the fronds as it holds the probe.
vec4 wMirror = waterMirrorSample(waterMirrorUv(vPositionW, normalW.xz, wDepth, vWaterViewDepth), waterMirrorSmearPx);
float wMirrorW = waterMirrorOn * waterMirrorWeight * (1.0 - wPaw) * waterCalmShare * wMirror.a;
finalRadianceScaled = mix(finalRadianceScaled, wMirror.rgb * colorSpecularEnvironmentReflectance, wMirrorW);
#endif
#endif
// The skin is matte: the sky's reflection and the sun's glint are held off it.
#ifdef REFLECTION
finalRadianceScaled *= 1.0 - wSkin;
#endif
#ifdef SPECULARTERM
finalSpecularScaled *= 1.0 - wSkin;
#endif
#ifdef OCEAN
// The white water is matte too.
#ifdef REFLECTION
finalRadianceScaled *= 1.0 - wFoam;
#endif
#ifdef SPECULARTERM
finalSpecularScaled *= 1.0 - wFoam;
#endif
#endif
finalEmissive += wTransmit;
