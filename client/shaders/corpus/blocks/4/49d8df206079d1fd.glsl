#define CUSTOM_FRAGMENT_BEGIN
layout(location = 1)  in vec3 vPositionW;
layout(location = 0)  in vec2 vMainUV1;
const float PI=3.1415926535897932384626433832795;
const float TWO_PI=6.283185307179586;
const float HALF_PI=1.5707963267948966;
const float RECIPROCAL_PI=0.3183098861837907;
const float RECIPROCAL_PI2=0.15915494309189535;
const float RECIPROCAL_PI4=0.07957747154594767;
const float HALF_MIN=5.96046448e-08;
const float LinearEncodePowerApprox=2.2;
const float GammaEncodePowerApprox=1.0/LinearEncodePowerApprox;
const vec3 LuminanceEncodeApprox=vec3(0.2126,0.7152,0.0722);
const float Epsilon=0.0000001;
#define saturate(x) clamp(x,0.0,1.0)
#define absEps(x) abs(x)+Epsilon
#define maxEps(x) max(x,Epsilon)
#define saturateEps(x) clamp(x,Epsilon,1.0)
mat3 transposeMat3(mat3 inMatrix) {vec3 i0=inMatrix[0];
vec3 i1=inMatrix[1];
vec3 i2=inMatrix[2];
mat3 outMatrix=mat3(
vec3(i0.x,i1.x,i2.x),
vec3(i0.y,i1.y,i2.y),
vec3(i0.z,i1.z,i2.z)
);
return outMatrix;
}