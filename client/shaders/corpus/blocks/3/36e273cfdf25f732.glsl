lightingInfo basicSpotLighting(vec3 viewDirectionW,vec3 lightVectorW,vec3 vNormal,float attenuation,vec3 diffuseColor,vec3 specularColor,float glossiness) {lightingInfo result;
float ndl=max(0.,dot(vNormal,lightVectorW));
result.diffuse=ndl*diffuseColor*attenuation;
return result;
}