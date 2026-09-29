vec3 singleScatterToMultiScatterAlbedo(vec3 rho_ss) {vec3 s=sqrt(max(vec3(1.0)-rho_ss,vec3(0.0)));
return (vec3(1.0)-s)*(vec3(1.0)-vec3(0.139)*s)/(vec3(1.0)+vec3(1.17)*s);
}