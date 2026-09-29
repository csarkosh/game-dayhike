ambientOcclusionOutParams ambientOcclusionBlock(
in vec3 ambientOcclusionColorMap_,
in vec4 vAmbientInfos
)
{ambientOcclusionOutParams outParams;
vec3 ambientOcclusionColor=vec3(1.,1.,1.);
vec3 ambientOcclusionColorMap=ambientOcclusionColorMap_*vAmbientInfos.y;
ambientOcclusionColorMap=vec3(ambientOcclusionColorMap.r,ambientOcclusionColorMap.r,ambientOcclusionColorMap.r);
ambientOcclusionColor=mix(ambientOcclusionColor,ambientOcclusionColorMap,vAmbientInfos.z);
outParams.ambientOcclusionColor=ambientOcclusionColor;
return outParams;
}