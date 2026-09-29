vec3 unit = info.attenuation * lightColor / SKIN_PI;
vec3 wrapped = unit * skinWrapLambert(info.NdotLUnclamped, skinWrap);
vec3 scatter = unit * skinTerminatorBand(info.NdotLUnclamped, skinWrap) * SKIN_SCATTER_TINT * skinScatter;
return mix(base, wrapped + scatter, mask);
}