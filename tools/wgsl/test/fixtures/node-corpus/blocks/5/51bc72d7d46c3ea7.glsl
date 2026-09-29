vec4 toGammaSpace(vec4 color)
{
return vec4(pow(color.rgb,vec3(GammaEncodePowerApprox)),color.a);
}