float normalDistributionFunction_TrowbridgeReitzGGX(float NdotH,float alphaG)
{float a2=square(alphaG);
float d=NdotH*NdotH*(a2-1.0)+1.0;
return a2/(PI*d*d);
}