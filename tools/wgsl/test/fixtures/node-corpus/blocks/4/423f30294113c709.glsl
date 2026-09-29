float dither(vec2 seed,float varianceAmount) {float rand=getRand(seed);
float normVariance=varianceAmount/255.0;
float dither=mix(-normVariance,normVariance,rand);
return dither;
}