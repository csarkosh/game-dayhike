vBedDepth = bedDepth;
// Babylon's view space is left-handed: +z runs forward, so this is positive.
vWaterViewDepth = (view * worldPos).z;
