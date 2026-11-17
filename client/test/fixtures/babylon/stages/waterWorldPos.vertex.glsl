// The game's shell on Babylon.js 9.18.0: the text of client/src/game/shaders/waterWorldPos.vertex.fx
vBedDepth = bedDepth;
// Babylon's view space is left-handed: +z runs forward, so this is positive.
vWaterViewDepth = (view * worldPos).z;
