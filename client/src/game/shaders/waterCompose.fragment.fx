// Water plugin, before the final colour composition: the bed's light through
// the surface on the high tier (zero elsewhere), added as emissive so fog and
// the colour path apply to it as to the rest of the surface.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
#ifndef OCEAN
#ifdef REFLECTION
// The lake's shore (lakeMirror.fragment.fx) takes the place of the sky
// probe's radiance, through PBR's own Fresnel, by the state's weight, the
// glass's share of the lake and the cat's-paws. Which shore is the tier's:
// the mirror's image where its target drew something (high), else the
// panorama (medium), else the skyline's shade (low, and medium where the
// panorama drew nothing), else the probe's own.
// The probe's radiance and the shade are scaled by the environment's
// intensity, as PBR scales the probe's own term (the eerie plateau dims
// it), while the mirror and the panorama are renders of the scene already
// lit as it is. Each flag is 0 or 1, so each mix picks one of its two, and
// within the branch every read runs. The reads run only while the weight can be above
// 0: where the state's weight or the glass's share is 0 the weight is 0 and
// the mix keeps PBR's own, so skipping them changes nothing. Both are
// uniforms, so the branch is the same for every pixel. Before the skin, which
// then holds it off the fronds as it holds the probe. The mirror's smear is a
// full paw's scaled by the paw mask: none on glass, where the image is sharp
// to the pixel.
// No energy-conservation factor or environment intensity on the mirror or the panorama: they are already-lit renders.
if (waterMirrorWeight * waterCalmShare > 0.0) {
  vec4 wMirror = waterMirrorSample(waterMirrorUv(vPositionW, normalW.xz, wDepth, vWaterViewDepth), waterMirrorSmearPx * wPaw);
  vec3 wProbeRadiance = reflectionOut.environmentRadiance.rgb * vLightingIntensity.z;
  vec3 wShoreRay = reflect(-viewDirectionW, normalW);
  vec3 wShore = mix(wProbeRadiance, waterSkylineRadiance(wShoreRay, wProbeRadiance), step(0.5, waterSkylineOn));
  wShore = mix(wShore, waterPanoramaRadiance(vPositionW, wShoreRay, wShore), step(0.5, waterPanoramaOn));
  wShore = mix(wShore, wMirror.rgb, step(0.5, waterMirrorOn) * wMirror.a);
  float wMirrorW = waterMirrorWeight * (1.0 - wPaw) * waterCalmShare;
  finalRadianceScaled = mix(finalRadianceScaled, wShore * colorSpecularEnvironmentReflectance, wMirrorW);
}
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
