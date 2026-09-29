vec3 toLinearSpace(vec3 color)
{
return pow(color,vec3(LinearEncodePowerApprox));
}