const float e=2.71828182845904523536028747135266249775724709369995957;
const float pi=3.141592653589793238462643383279502884197169;
const float n=1.0003;
const float N=2.545E25;
const float pn=0.035;
const vec3 lambda=vec3(680E-9,550E-9,450E-9);
const vec3 K=vec3(0.686,0.678,0.666);
const float v=4.0;
const float rayleighZenithLength=8.4E3;
const float mieZenithLength=1.25E3;
const float EE=1000.0;
const float sunAngularDiameterCos=0.999956676946448443553574619906976478926848692873900859324;
const float cutoffAngle=pi/1.95;
const float steepness=1.5;
vec3 totalRayleigh(vec3 lambda)
{return (8.0*pow(pi,3.0)*pow(pow(n,2.0)-1.0,2.0)*(6.0+3.0*pn))/(3.0*N*pow(lambda,vec3(4.0))*(6.0-7.0*pn));
}