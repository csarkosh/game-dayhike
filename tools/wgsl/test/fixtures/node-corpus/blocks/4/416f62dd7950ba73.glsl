vec3 double_refract(vec3 I,vec3 N,float eta) {vec3 Tfront=refract(I,N,1.0/eta);
vec3 Nback=normalize(reflect(N,Tfront));
return refract(Tfront,-Nback,eta);
}