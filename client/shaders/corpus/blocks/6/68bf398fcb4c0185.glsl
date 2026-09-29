// A smooth bump centred on the terminator, zero beyond plus or minus wrap.
float skinTerminatorBand(float ndotl, float wrap) {
float t = clamp(ndotl / max(wrap, 1e-4), -1.0, 1.0);
return 1.0 - t * t;
}