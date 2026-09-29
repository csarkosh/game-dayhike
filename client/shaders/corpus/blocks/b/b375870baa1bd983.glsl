float computeDirectionalLightFalloff_Standard(vec3 lightDirection,vec3 directionToLightCenterW,float cosHalfAngle,float exponent)
{float falloff=0.0;
float cosAngle=maxEps(dot(-lightDirection,directionToLightCenterW));
if (cosAngle>=cosHalfAngle)
{falloff=max(0.,pow(cosAngle,exponent));
}