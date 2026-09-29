#define CUSTOM_VERTEX_UPDATE_WORLDPOS
gl_Position=viewProjection*worldPos;
vec2 uv2Updated=vec2(0.,0.);
if (vAlbedoInfos.x==0.)
{vAlbedoUV=vec2(albedoMatrix*vec4(uvUpdated,1.0,0.0));
}