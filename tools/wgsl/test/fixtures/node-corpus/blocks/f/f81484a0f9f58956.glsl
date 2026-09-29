float getIESAttenuation(float cosAngle,sampler2D iesLightSampler) {float angle=acos(cosAngle)/PI;
return texture(iesLightSampler,vec2(angle,0.)).r;
}