
  let wMirror=waterMirrorSample(waterMirrorUv(input.worldPos,N.xz,wDepth,input.vWaterViewDepth),material.waterMirrorSmearPx*wPaw+min(material.waterMirrorMotion/max(input.vWaterViewDepth,1.0),LAKE_MOTION_SMEAR_CAP*material.fadeRows));
