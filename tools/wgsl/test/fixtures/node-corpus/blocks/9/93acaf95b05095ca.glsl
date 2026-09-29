vec2 pixel = vUV / texelSize;
float l = finishLuma(c);
float weight = (1.0 - l) * smoothstep(0.0, 0.15, l) + 0.15 * (1.0 - l);
float g = finishNoise(pixel, fract(time * 7.31)) - 0.5;
c += g * grainGain * weight;
float d1 = finishNoise(pixel, fract(time * 3.17));
float d2 = finishNoise(pixel + vec2(37.0, 11.0), fract(time * 5.03));
c += (d1 + d2 - 1.0) * DITHER_LSB;
glFragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}