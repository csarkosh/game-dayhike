// Water plugin, before the final colour composition: the bed's light through
// the surface on the high tier (zero elsewhere), added as emissive so fog and
// the colour path apply to it as to the rest of the surface.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
// The skin is matte: the sky's reflection and the sun's glint are held off it.
#ifdef REFLECTION
finalRadianceScaled *= 1.0 - wSkin;
#endif
#ifdef SPECULARTERM
finalSpecularScaled *= 1.0 - wSkin;
#endif
finalEmissive += wTransmit;
