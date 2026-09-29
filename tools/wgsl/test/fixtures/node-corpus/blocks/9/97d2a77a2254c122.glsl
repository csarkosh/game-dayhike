float getLuminance(vec3 color)
{return saturate(getLuminanceUnclamped(color));
}