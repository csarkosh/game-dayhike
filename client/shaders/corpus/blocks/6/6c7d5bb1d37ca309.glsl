vec3 unit = info.attenuation * lightColor / FOLIAGE_PI;
vec3 wrapped = unit * foliageWrapLambert(info.NdotLUnclamped, FOLIAGE_WRAP);
float back = pow(clamp(-dot(viewDir, info.L), 0.0, 1.0), FOLIAGE_BACK_POWER);
float thickness = 1.0 - 0.7 * h;
return wrapped + unit * FOLIAGE_BACK * back * thickness;
}