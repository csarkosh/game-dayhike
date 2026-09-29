float getLinearLodFromRoughness(float cubeMapDimensionPixels,float roughness) {float lod=log2(cubeMapDimensionPixels)*roughness;
return lod;
}