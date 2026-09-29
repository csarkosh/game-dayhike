float ndl=max(0.,dot(vNormal,lightVectorW));
result.diffuse=ndl*diffuseColor*attenuation;
return result;
}