float macroNoise(vec2 p) {
return MACRO_WEIGHT.x * macroValueNoise(p, MACRO_WAVE.x) + MACRO_WEIGHT.y * macroValueNoise(p, MACRO_WAVE.y);
}