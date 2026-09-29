lightingInfo computeHemisphericLighting(vec3 viewDirectionW,vec3 vNormal,vec4 lightData,vec3 diffuseColor,vec3 specularColor,vec3 groundColor,float glossiness) {lightingInfo result;
float ndl=dot(vNormal,lightData.xyz)*0.5+0.5;
result.diffuse=mix(groundColor,diffuseColor,ndl);
return result;
}