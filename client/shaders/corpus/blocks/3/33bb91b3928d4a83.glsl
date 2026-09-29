vec2 gcOff = worldPos.xz - finalWorld[3].xz;
float gcW = 1.0 - smoothstep(0.0, gcRamp, positionUpdated.y);
worldPos.y += gcW * min(0.0, gcOvershoot * dot(gcOff, groundGrad));
#define CUSTOM_VERTEX_UPDATE_WORLDPOS
gl_Position=viewProjection*worldPos;
vec2 uv2Updated=vec2(0.,0.);
if (vAlbedoInfos.x==0.)
{vAlbedoUV=vec2(albedoMatrix*vec4(uvUpdated,1.0,0.0));
}