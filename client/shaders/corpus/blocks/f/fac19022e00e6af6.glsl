float environmentRadianceOcclusion(float ambientOcclusion,float NdotVUnclamped) {float temp=NdotVUnclamped+ambientOcclusion;
return saturate(square(temp)-1.0+ambientOcclusion);
}