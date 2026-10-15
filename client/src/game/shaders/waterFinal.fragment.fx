// Water plugin, after the fog and before the fragment's colour is written:
// the bed's light through the surface on the high tier (zero elsewhere),
// wTransmit from waterLights.fragment.fx. The bed is read from the opaque
// pass's copy, which the atmosphere hazed to the bed's distance as it drew
// it, so it is added past the surface's own haze rather than through the
// emissive before it: added there it took the haze twice, and every shallow
// where the bed showed lit up in the haze's colour along the depth's contour.
// The colour path runs as a post-process, so nothing else follows the fog.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
finalColor.rgb += wTransmit;
