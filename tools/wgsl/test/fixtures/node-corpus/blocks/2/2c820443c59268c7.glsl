lightingInfo computeIESSpotLighting(vec3 viewDirectionW,vec3 vNormal,vec4 lightData,vec4 lightDirection,vec3 diffuseColor,vec3 specularColor,float range,float glossiness,sampler2D iesLightSampler) {
vec3 direction=lightData.xyz-vPositionW;
vec3 lightVectorW=normalize(direction);
float attenuation=max(0.,1.0-length(direction)/range);
float dotProduct=dot(lightDirection.xyz,-lightVectorW);
float cosAngle=max(0.,dotProduct);
if (cosAngle>=lightDirection.w)
{
attenuation*=getIESAttenuation(dotProduct,iesLightSampler);
return basicSpotLighting(viewDirectionW,lightVectorW,vNormal,attenuation,diffuseColor,specularColor,glossiness);
}