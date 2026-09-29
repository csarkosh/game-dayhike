influence+=readMatrixFromRawSampler_3*matricesWeights[3];
finalWorld=finalWorld*influence;
vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);
vPositionW=vec3(worldPos);
mat3 normalWorld=mat3(finalWorld);
vNormalW=normalize(normalWorld*normalUpdated);
#define CUSTOM_VERTEX_UPDATE_WORLDPOS
gl_Position=viewProjection*worldPos;
vec2 uv2Updated=vec2(0.,0.);
vMainUV1=uvUpdated;
vFogDistance=(view*worldPos).xyz;
vPositionFromCamera1=view*worldPos;
for (int i=0;
i<SHADOWCSMNUM_CASCADES1;
i++) {vPositionFromLight1[i]=lightMatrix1[i]*worldPos;
vDepthMetric1[i]=(vPositionFromLight1[i].z+light1.depthValues.x)/light1.depthValues.y;
}