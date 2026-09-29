vec4 toLinearSpace(vec4 color)
{
return vec4(pow(color.rgb,vec3(LinearEncodePowerApprox)),color.a);
}