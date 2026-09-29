float getLuminanceUnclamped(vec3 color)
{return dot(color,LuminanceEncodeApprox);
}