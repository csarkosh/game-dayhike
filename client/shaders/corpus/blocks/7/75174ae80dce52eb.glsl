vFadeBands = fadeBands;
vFadeDist = distance(finalWorld[3].xz, fadeEye.xz);
#define CUSTOM_VERTEX_UPDATE_WORLDPOS
gl_Position=viewProjection*worldPos;
vec2 uv2Updated=vec2(0.,0.);
vMainUV1=uvUpdated;
vec3 tbnNormal=normalize(normalUpdated);
vec3 tbnTangent=normalize(tangentUpdated.xyz);
vec3 tbnBitangent=cross(tbnNormal,tbnTangent)*tangentUpdated.w;
vTBN=mat3(finalWorld)*mat3(tbnTangent,tbnBitangent,tbnNormal);
vFogDistance=(view*worldPos).xyz;
#define CUSTOM_VERTEX_MAIN_END
gl_Position.y *= yFactor_;
}