lightingInfo computeLighting(vec3 viewDirectionW,vec3 vNormal,vec4 lightData,vec3 diffuseColor,vec3 specularColor,float range,float glossiness) {lightingInfo result;
vec3 lightVectorW;
float attenuation=1.0;
if (lightData.w==0.)
{vec3 direction=lightData.xyz-vPositionW;
attenuation=max(0.,1.0-length(direction)/range);
lightVectorW=normalize(direction);
}