float ndl=max(0.,dot(vNormal,lightVectorW));
result.diffuse=ndl*diffuseColor*attenuation;
vec3 angleW=normalize(viewDirectionW+lightVectorW);
float specComp=max(0.,dot(vNormal,angleW));
specComp=pow(specComp,max(1.,glossiness));
result.specular=specComp*specularColor*attenuation;
return result;
}