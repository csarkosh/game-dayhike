
var wRadianceScaled=finalRadianceScaled;
if(material.waterMirrorWeight*material.waterCalmShare>0.0){${mirrorRead}
  let wProbeRadiance=environmentRadiance;
  let wShoreRay=reflect(-V,N);
  ${shoreDeclaration} wShore=mix(wProbeRadiance,waterSkylineRadiance(wShoreRay,wProbeRadiance),step(0.5,material.waterSkylineOn));${panoramaRead}${mirrorMix}
  let wMirrorW=material.waterMirrorWeight*(1.0-wPaw)*material.waterCalmShare;
  wRadianceScaled=mix(wRadianceScaled,wShore*colorSpecularEnvReflectance,wMirrorW);
}
wRadianceScaled*=1.0-wSkin;
let wSpecularScaled=finalSpecularScaled*(1.0-wSkin);
color=finalIrradiance+wRadianceScaled+wSpecularScaled+directDiffuse+emissive;
