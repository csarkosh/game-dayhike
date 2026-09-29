float computeDirectionalLightFalloff_IES(vec3 lightDirection,vec3 directionToLightCenterW,sampler2D iesLightSampler)
{float cosAngle=dot(-lightDirection,directionToLightCenterW);
float angle=acos(cosAngle)/PI;
return texture(iesLightSampler,vec2(angle,0.)).r;
}