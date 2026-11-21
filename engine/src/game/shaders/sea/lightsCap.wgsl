if(material.oceanCoast.w>0.5){
  let wCapCover=oceanCapCoverage(input.vOceanXZ,wWindShare);
  wOceanCap=mix(wCapCover,oceanWhitecap(wCapCover,wWind.y/max(material.oceanWindStats.x,1.0e-4)),oceanCrestKeep(wOceanPixel));
}else{
  wOceanCap=oceanCapCells(input.vOceanXZ,wOceanPixel,wWindShare);
}
