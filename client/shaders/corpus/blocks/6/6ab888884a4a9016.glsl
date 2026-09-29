vec3 toGammaSpace(vec3 color)
{
return pow(color,vec3(GammaEncodePowerApprox));
}