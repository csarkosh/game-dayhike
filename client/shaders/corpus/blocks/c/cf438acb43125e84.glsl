float environmentHorizonOcclusion(vec3 view,vec3 normal,vec3 geometricNormal) {vec3 reflection=reflect(view,normal);
float temp=saturate(1.0+1.1*dot(reflection,geometricNormal));
return square(temp);
}