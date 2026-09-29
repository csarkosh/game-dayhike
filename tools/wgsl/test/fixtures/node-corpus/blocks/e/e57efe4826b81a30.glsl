vec3 multiScatterToSingleScatterAlbedo(vec3 rho_ms) {vec3 s=4.09712+4.20863*rho_ms-sqrt(9.59217+41.6808*rho_ms+17.7126*rho_ms*rho_ms);
return 1.0-s*s;
}