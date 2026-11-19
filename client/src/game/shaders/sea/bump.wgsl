
surfaceAlbedo=baseColor;
{
  let wMap=textureSample(waterBump,waterBumpSampler,input.uv+material.seaBumpOffset).xyz*2.0-1.0;
  let wUp=vec3<f32>(0.0,1.0,0.0);
  let wDp1=dpdx(input.worldPos);
  let wDp2=-dpdy(input.worldPos);
  let wDuv1=dpdx(input.uv);
  let wDuv2=-dpdy(input.uv);
  let wDp2perp=cross(wDp2,wUp);
  let wDp1perp=cross(wUp,wDp1);
  let wTangent=wDp2perp*wDuv1.x+wDp1perp*wDuv2.x;
  let wBitangent=wDp2perp*wDuv1.y+wDp1perp*wDuv2.y;
  let wDet=max(dot(wTangent,wTangent),dot(wBitangent,wBitangent));
  let wInvmax=select(inverseSqrt(wDet),0.0,wDet==0.0);
  N=normalize(wTangent*(wInvmax*wMap.x)+wBitangent*(wInvmax*wMap.y)+wUp*wMap.z);
}
