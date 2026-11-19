if(material.atmCloudSteps<0.5){return fogged;}
  let od=atmCloudDepth(eye,rd,d);
  let cloudGlow=pow(max(dot(rd,material.atmSunDir),0.0),material.atmCloudGlow.y)*material.atmCloudGlow.x;
  let cloud=material.atmCloudColour+material.atmSunColour*cloudGlow;
  return mix(cloud,fogged,exp(-od));
