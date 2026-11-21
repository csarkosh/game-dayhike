
let wRadianceScaled=finalRadianceScaled*(1.0-wFoam);
let wSpecularScaled=finalSpecularScaled*(1.0-wFoam);
color=finalIrradiance+wRadianceScaled+wSpecularScaled+directDiffuse+emissive;
