layout(location = 5)  in vec4 vFadeBands;
layout(location = 6)  in float vFadeDist;
float dfNoise(vec2 p) {
return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
}