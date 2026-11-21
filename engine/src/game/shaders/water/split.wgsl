
NdotVUnclamped=dot(N,V);
NdotV=abs(NdotVUnclamped)+0.0000001;
{
  let wF0=dielectricF0*WATER_F0_FACTOR;
  colorF0=vec3<f32>(wF0);
  colorF90=vec3<f32>(WATER_F0_FACTOR);
  surfaceAlbedo*=1.0-wF0;
}
