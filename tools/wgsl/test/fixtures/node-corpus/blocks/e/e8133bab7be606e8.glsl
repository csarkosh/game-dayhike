outParams.reflectanceF90=vec3(outParams.specularWeight);
float f90Scale=1.0;
outParams.dielectricColorF0=vec3(dielectricF0*surfaceReflectivityColor);
vec3 metallicColorF0=baseColor.rgb;
outParams.colorReflectanceF0=mix(outParams.dielectricColorF0,metallicColorF0,outParams.metallic);
vec3 dielectricColorF90=vec3(outParams.specularWeight*f90Scale);
vec3 conductorColorF90=outParams.reflectanceF90;
outParams.colorReflectanceF90=mix(dielectricColorF90,conductorColorF90,outParams.metallic);
microSurface=saturate(microSurface);
float roughness=1.-microSurface;
float diffuseRoughness=baseDiffuseRoughness;
outParams.microSurface=microSurface;
outParams.roughness=roughness;
outParams.diffuseRoughness=diffuseRoughness;
return outParams;
}