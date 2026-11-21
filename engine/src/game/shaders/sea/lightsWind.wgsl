let wWind=oceanWindDisplace(input.vOceanXZ);
let wWindSlopes=oceanWindSlopesAt(input.vOceanXZ,max(length(wOceanDx),length(wOceanDy)));
let wWindDrawn=wWindSlopes.drawn;
let wWindSlope=wWindSlopes.slope;
let wSurfaceHeight=wOceanHeight+wWind.y*wWindAmp;
