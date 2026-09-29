vec3 totalMie(vec3 lambda,vec3 K,float T)
{float c=(0.2*T )*10E-18;
return 0.434*c*pi*pow((2.0*pi)/lambda,vec3(v-2.0))*K;
}