{
  let oceanLip=oceanLipPlace(position);
  out.vOceanXZ=oceanLip.xz;
  out.vOceanSwellA=oceanLip.swell;
  out.vOceanSwellB=oceanLip.env;
  out.worldPos=oceanLip.place;
  out.clipPos=scene.viewProjection*vec4<f32>(oceanLip.place,1.0);
  out.vBedDepth=0.0;
  out.vWaterViewDepth=out.clipPos.w;
}
