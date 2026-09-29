layout(location = 5)  in vec3 vFogDistance;
float CalcFogFactor()
{float fogCoeff=1.0;
float fogStart=vFogInfos.y;
float fogEnd=vFogInfos.z;
float fogDensity=vFogInfos.w;
float fogDistance=length(vFogDistance);
if (FOGMODE_LINEAR==vFogInfos.x)
{fogCoeff=(fogEnd-fogDistance)/(fogEnd-fogStart);
}