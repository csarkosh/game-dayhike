#define CUSTOM_VERTEX_UPDATE_WORLDPOS
gl_Position=viewProjection*worldPos;
vec2 uvUpdated=vec2(0.,0.);
vec2 uv2Updated=vec2(0.,0.);
vFogDistance=(view*worldPos).xyz;
vPositionFromCamera1=view*worldPos;
for (int i=0;
i<SHADOWCSMNUM_CASCADES1;
i++) {vPositionFromLight1[i]=lightMatrix1[i]*worldPos;
vDepthMetric1[i]=(vPositionFromLight1[i].z+light1.depthValues.x)/light1.depthValues.y;
}