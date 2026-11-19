
{
  terrainFarW*=1.0-terrainPaintW;
  if(terrainFarW>0.0){
    N=normalize(mix(N,terrainFarN,terrainFarW));
    var fcEye=vec3<f32>(V.x,0.0,V.z);
    fcEye/=max(length(fcEye),1e-4);
    terrainFarN=normalize(N+fcEye*FAR_COVER_TILT);
    terrainSpecW=1.0-FAR_SPEC_CUT*terrainFarW*(1.0-terrainWet);
  }
}
roughness=clamp(roughness*terrainRough,0.0,1.0);
NdotVUnclamped=dot(N,V);
NdotV=abs(NdotVUnclamped)+0.0000001;
