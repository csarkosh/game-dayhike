const float OVERLAP_INNER = 0.4;
const float OVERLAP_SCALE = 1.06;
const float OVERLAP_ECHO = 0.6;
const float DITHER_LSB = 0.00392156862745098;
const float TWO_PI = 6.28318530718;
float finishLuma(vec3 c) {
return dot(c, vec3(0.2126, 0.7152, 0.0722));
}