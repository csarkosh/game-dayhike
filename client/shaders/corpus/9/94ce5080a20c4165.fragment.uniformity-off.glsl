#version 450
#define MATERIALPLUGIN_7
#define DETAILDIRECTUV 0
#define DETAIL_NORMALBLENDMETHOD 0
#define PREPASS_COLOR_INDEX -1
#define PREPASS_IRRADIANCE_LEGACY_INDEX -1
#define PREPASS_IRRADIANCE_INDEX -1
#define PREPASS_ALBEDO_INDEX -1
#define PREPASS_ALBEDO_SQRT_INDEX -1
#define PREPASS_DEPTH_INDEX -1
#define PREPASS_SCREENSPACE_DEPTH_INDEX -1
#define PREPASS_NORMALIZED_VIEW_DEPTH_INDEX -1
#define PREPASS_NORMAL_INDEX -1
#define PREPASS_WORLD_NORMAL_INDEX -1
#define PREPASS_POSITION_INDEX -1
#define PREPASS_LOCAL_POSITION_INDEX -1
#define PREPASS_VELOCITY_INDEX -1
#define PREPASS_VELOCITY_LINEAR_INDEX -1
#define PREPASS_REFLECTIVITY_INDEX -1
#define SCENE_MRT_COUNT 0
#define TONEMAPPING 0
#define IMAGEPROCESSINGPOSTPROCESS
#define DIFFUSEDIRECTUV 0
#define AMBIENTDIRECTUV 0
#define OPACITYDIRECTUV 0
#define EMISSIVEDIRECTUV 0
#define SPECULARDIRECTUV 0
#define BUMPDIRECTUV 0
#define FOG
#define SPECULARTERM
#define NORMAL
#define NUM_BONE_INFLUENCERS 0
#define BonesPerMesh 0
#define LIGHTMAPDIRECTUV 0
#define SHADOWFLOAT
#define NUM_MORPH_INFLUENCERS 0
#define ALPHABLEND
#define ORDER_INDEPENDENT_TRANSPARENCY_16BITS
#define CAMERA_PERSPECTIVE
#define AREALIGHTSUPPORTED
#define VERTEX_PULLING_USE_INDEX_BUFFER
#define CLUSTLIGHT_SLICES 0
#define CLUSTLIGHT_BATCH 0
#define TEXTURE_REPETITION_MODE 0
#define LIGHT0
#define SPOTLIGHT0
#define LIGHT1
#define DIRLIGHT1
#define SHADOW1
#define SHADOWCSM1
#define SHADOWCSMNUM_CASCADES1 2
#define SHADOWCSMUSESHADOWMAXZ1
#define SHADOWPCF1
#define LIGHT2
#define HEMILIGHT2
#define SHADOWS
#define LIGHTCOUNT 3
#define MAXLIGHTCOUNT 4

#define SHADER_NAME fragment:default
layout(set = 1, binding = 8) uniform LeftOver {
        mat4 lightMatrix1[2];
    float viewFrustumZ1[2];
    float frustumLengths1[2];
    float cascadeBlendFactor1;
    vec4 vFogInfos;
    vec3 vFogColor;
};

precision highp float;
// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};

#define CUSTOM_FRAGMENT_EXTENSION
layout(std140,column_major) uniform;
layout(set = 1, binding = 1) uniform Material
{vec4 diffuseLeftColor;
vec4 diffuseRightColor;
vec4 opacityParts;
vec4 reflectionLeftColor;
vec4 reflectionRightColor;
vec4 refractionLeftColor;
vec4 refractionRightColor;
vec4 emissiveLeftColor;
vec4 emissiveRightColor;
vec2 vDiffuseInfos;
vec2 vAmbientInfos;
vec2 vOpacityInfos;
vec2 vEmissiveInfos;
vec2 vLightmapInfos;
vec2 vSpecularInfos;
vec3 vBumpInfos;
mat4 diffuseMatrix;
mat4 ambientMatrix;
mat4 opacityMatrix;
mat4 emissiveMatrix;
mat4 lightmapMatrix;
mat4 specularMatrix;
mat4 bumpMatrix;
vec2 vTangentSpaceParams;
float pointSize;
float alphaCutOff;
mat4 refractionMatrix;
vec4 vRefractionInfos;
vec3 vRefractionPosition;
vec3 vRefractionSize;
vec4 vSpecularColor;
vec3 vEmissiveColor;
vec4 vDiffuseColor;
vec3 vAmbientColor;
vec4 cameraInfo;
vec4 vTextureRepetitionHexTilingParams;
vec2 vReflectionInfos;
mat4 reflectionMatrix;
vec3 vReflectionPosition;
vec3 vReflectionSize;
vec4 vDetailInfos;
mat4 detailMatrix;
};
layout(std140,column_major) uniform;
layout(set = 0, binding = 0) uniform Scene {mat4 viewProjection;
mat4 view;
mat4 projection;
vec4 vEyePosition;
mat4 inverseProjection;
};
layout(std140,column_major) uniform;
layout(set = 1, binding = 2) uniform Mesh
{mat4 world;
float visibility;
};
#define WORLD_UBO
#define CUSTOM_FRAGMENT_BEGIN
layout(location = 0)  in vec3 vPositionW;
layout(location = 1)  in vec3 vNormalW;
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
mat3 inverseMat3(mat3 inMatrix) {float a00=inMatrix[0][0],a01=inMatrix[0][1],a02=inMatrix[0][2];
float a10=inMatrix[1][0],a11=inMatrix[1][1],a12=inMatrix[1][2];
float a20=inMatrix[2][0],a21=inMatrix[2][1],a22=inMatrix[2][2];
float b01=a22*a11-a12*a21;
float b11=-a22*a10+a12*a20;
float b21=a21*a10-a11*a20;
float det=a00*b01+a01*b11+a02*b21;
return mat3(b01,(-a22*a01+a02*a21),(a12*a01-a02*a11),
b11,(a22*a00-a02*a20),(-a12*a00+a02*a10),
b21,(-a21*a00+a01*a20),(a11*a00-a01*a10))/det;
}
float toLinearSpace(float color)
{
return pow(color,LinearEncodePowerApprox);
}
vec3 toLinearSpace(vec3 color)
{
return pow(color,vec3(LinearEncodePowerApprox));
}
vec4 toLinearSpace(vec4 color)
{
return vec4(pow(color.rgb,vec3(LinearEncodePowerApprox)),color.a);
}
float toGammaSpace(float color)
{
return pow(color,GammaEncodePowerApprox);
}
vec3 toGammaSpace(vec3 color)
{
return pow(color,vec3(GammaEncodePowerApprox));
}
vec4 toGammaSpace(vec4 color)
{
return vec4(pow(color.rgb,vec3(GammaEncodePowerApprox)),color.a);
}
float square(float value)
{return value*value;
}
vec3 square(vec3 value)
{return value*value;
}
float pow5(float value) {float sq=value*value;
return sq*sq*value;
}
vec3 double_refract(vec3 I,vec3 N,float eta) {vec3 Tfront=refract(I,N,1.0/eta);
vec3 Nback=normalize(reflect(N,Tfront));
return refract(Tfront,-Nback,eta);
}
float getLuminanceUnclamped(vec3 color)
{return dot(color,LuminanceEncodeApprox);
}
float getLuminance(vec3 color)
{return saturate(getLuminanceUnclamped(color));
}
float getRand(vec2 seed) {return fract(sin(dot(seed.xy ,vec2(12.9898,78.233)))*43758.5453);
}
float dither(vec2 seed,float varianceAmount) {float rand=getRand(seed);
float normVariance=varianceAmount/255.0;
float dither=mix(-normVariance,normVariance,rand);
return dither;
}
const float rgbdMaxRange=255.;
vec4 toRGBD(vec3 color) {float maxRGB=maxEps(max(color.r,max(color.g,color.b)));
float D =max(rgbdMaxRange/maxRGB,1.);
D =saturate(floor(D)/255.);
vec3 rgb=color.rgb*D;
rgb=toGammaSpace(rgb);
return vec4(saturate(rgb),D);
}
vec3 fromRGBD(vec4 rgbd) {rgbd.rgb=toLinearSpace(rgbd.rgb);
return rgbd.rgb/rgbd.a;
}
vec3 parallaxCorrectNormal( vec3 vertexPos,vec3 origVec,vec3 cubeSize,vec3 cubePos ) {vec3 invOrigVec=vec3(1.)/origVec;
vec3 halfSize=cubeSize*0.5;
vec3 intersecAtMaxPlane=(cubePos+halfSize-vertexPos)*invOrigVec;
vec3 intersecAtMinPlane=(cubePos-halfSize-vertexPos)*invOrigVec;
vec3 largestIntersec=max(intersecAtMaxPlane,intersecAtMinPlane);
float distance=min(min(largestIntersec.x,largestIntersec.y),largestIntersec.z);
vec3 intersectPositionWS=vertexPos+origVec*distance;
return intersectPositionWS-cubePos;
}
vec3 equirectangularToCubemapDirection(vec2 uv) {float longitude=uv.x*TWO_PI-PI;
float latitude=HALF_PI-uv.y*PI;
vec3 direction;
direction.x=cos(latitude)*sin(longitude);
direction.y=sin(latitude);
direction.z=cos(latitude)*cos(longitude);
return direction;
}
float sqrtClamped(float value) {return sqrt(max(value,0.));
}
float avg(vec3 value) {return dot(value,vec3(0.333333333));
}
uint extractBits(uint value,int offset,int width) {return (value>>offset) & ((1u<<width)-1u);
}
int onlyBitPosition(uint value) {return (floatBitsToInt(float(value))>>23)-0x7f;
}
vec3 singleScatterToMultiScatterAlbedo(vec3 rho_ss) {vec3 s=sqrt(max(vec3(1.0)-rho_ss,vec3(0.0)));
return (vec3(1.0)-s)*(vec3(1.0)-vec3(0.139)*s)/(vec3(1.0)+vec3(1.17)*s);
}
vec3 multiScatterToSingleScatterAlbedo(vec3 rho_ms) {vec3 s=4.09712+4.20863*rho_ms-sqrt(9.59217+41.6808*rho_ms+17.7126*rho_ms*rho_ms);
return 1.0-s*s;
}
vec3 multiScatterToSingleScatterAlbedo(vec3 rho_ms,float aniso) {vec3 s=4.09712+4.20863*rho_ms-sqrt(9.59217+41.6808*rho_ms+17.7126*rho_ms*rho_ms);
return (1.0-s*s)/maxEps(1.0-aniso*s*s);
}
float min3(vec3 v) {return min(v.x,min(v.y,v.z));
}
float max3(vec3 v) {return max(v.x,max(v.y,v.z));
}
float uint2float(uint i) {return uintBitsToFloat(0x3F800000u | (i>>9u))-1.0;
}
vec2 plasticSequence(const uint rstate) {return vec2(uint2float(rstate*3242174889u),
uint2float(rstate*2447445414u));
}
layout(set = 1, binding = 3) uniform Light0
{vec4 vLightData;
vec4 vLightDiffuse;
vec4 vLightSpecular;
vec4 vLightDirection;
vec4 vLightFalloff;
vec4 shadowsInfo;
vec2 depthValues;
} light0;
layout(set = 1, binding = 4) uniform Light1
{vec4 vLightData;
vec4 vLightDiffuse;
vec4 vLightSpecular;
vec4 shadowsInfo;
vec2 depthValues;
} light1;




layout(location = 3)  in vec4 vPositionFromLight1[SHADOWCSMNUM_CASCADES1];
layout(location = 5)  in float vDepthMetric1[SHADOWCSMNUM_CASCADES1];
layout(location = 7)  in vec4 vPositionFromCamera1;
layout(set = 1, binding = 7) uniform samplerShadow shadowTexture1Sampler;
                        layout(set = 1, binding = 6) uniform texture2DArray shadowTexture1Texture;
                        #define shadowTexture1 sampler2DArrayShadow(shadowTexture1Texture, shadowTexture1Sampler)
int index1=-1;
float diff1=0.;
layout(set = 1, binding = 5) uniform Light2
{vec4 vLightData;
vec4 vLightDiffuse;
vec4 vLightSpecular;
vec3 vLightGround;
vec4 shadowsInfo;
vec2 depthValues;
} light2;
struct lightingInfo
{vec3 diffuse;
vec3 specular;
};
lightingInfo computeLighting(vec3 viewDirectionW,vec3 vNormal,vec4 lightData,vec3 diffuseColor,vec3 specularColor,float range,float glossiness) {lightingInfo result;
vec3 lightVectorW;
float attenuation=1.0;
if (lightData.w==0.)
{vec3 direction=lightData.xyz-vPositionW;
attenuation=max(0.,1.0-length(direction)/range);
lightVectorW=normalize(direction);
}
else
{lightVectorW=normalize(-lightData.xyz);
}
float ndl=max(0.,dot(vNormal,lightVectorW));
result.diffuse=ndl*diffuseColor*attenuation;
vec3 angleW=normalize(viewDirectionW+lightVectorW);
float specComp=max(0.,dot(vNormal,angleW));
specComp=pow(specComp,max(1.,glossiness));
result.specular=specComp*specularColor*attenuation;
return result;
}
float getAttenuation(float cosAngle,float exponent) {return max(0.,pow(cosAngle,exponent));
}
float getIESAttenuation(float cosAngle,sampler2D iesLightSampler) {float angle=acos(cosAngle)/PI;
return texture(iesLightSampler,vec2(angle,0.)).r;
}
lightingInfo basicSpotLighting(vec3 viewDirectionW,vec3 lightVectorW,vec3 vNormal,float attenuation,vec3 diffuseColor,vec3 specularColor,float glossiness) {lightingInfo result;
float ndl=max(0.,dot(vNormal,lightVectorW));
result.diffuse=ndl*diffuseColor*attenuation;
vec3 angleW=normalize(viewDirectionW+lightVectorW);
float specComp=max(0.,dot(vNormal,angleW));
specComp=pow(specComp,max(1.,glossiness));
result.specular=specComp*specularColor*attenuation;
return result;
}
lightingInfo computeIESSpotLighting(vec3 viewDirectionW,vec3 vNormal,vec4 lightData,vec4 lightDirection,vec3 diffuseColor,vec3 specularColor,float range,float glossiness,sampler2D iesLightSampler) {
vec3 direction=lightData.xyz-vPositionW;
vec3 lightVectorW=normalize(direction);
float attenuation=max(0.,1.0-length(direction)/range);
float dotProduct=dot(lightDirection.xyz,-lightVectorW);
float cosAngle=max(0.,dotProduct);
if (cosAngle>=lightDirection.w)
{
attenuation*=getIESAttenuation(dotProduct,iesLightSampler);
return basicSpotLighting(viewDirectionW,lightVectorW,vNormal,attenuation,diffuseColor,specularColor,glossiness);
}
lightingInfo result;
result.diffuse=vec3(0.);
result.specular=vec3(0.);
return result;
}
lightingInfo computeSpotLighting(vec3 viewDirectionW,vec3 vNormal,vec4 lightData,vec4 lightDirection,vec3 diffuseColor,vec3 specularColor,float range,float glossiness) {vec3 direction=lightData.xyz-vPositionW;
vec3 lightVectorW=normalize(direction);
float attenuation=max(0.,1.0-length(direction)/range);
float cosAngle=max(0.,dot(lightDirection.xyz,-lightVectorW));
if (cosAngle>=lightDirection.w)
{
attenuation*=getAttenuation(cosAngle,lightData.w);
return basicSpotLighting(viewDirectionW,lightVectorW,vNormal,attenuation,diffuseColor,specularColor,glossiness);
}
lightingInfo result;
result.diffuse=vec3(0.);
result.specular=vec3(0.);
return result;
}
lightingInfo computeHemisphericLighting(vec3 viewDirectionW,vec3 vNormal,vec4 lightData,vec3 diffuseColor,vec3 specularColor,vec3 groundColor,float glossiness) {lightingInfo result;
float ndl=dot(vNormal,lightData.xyz)*0.5+0.5;
result.diffuse=mix(groundColor,diffuseColor,ndl);
vec3 angleW=normalize(viewDirectionW+lightData.xyz);
float specComp=max(0.,dot(vNormal,angleW));
specComp=pow(specComp,max(1.,glossiness));
result.specular=specComp*specularColor;
return result;
}

#define TEXTUREFUNC(s,c,l) textureLod(s,c,l)
float computeFallOff(float value,vec2 clipSpace,float frustumEdgeFalloff)
{float mask=smoothstep(1.0-frustumEdgeFalloff,1.00000012,clamp(dot(clipSpace,clipSpace),0.,1.));
return mix(value,1.0,mask);
}









#define ZINCLIP clipSpace.z
#define SMALLEST_ABOVE_ZERO 1.1754943508e-38
#define GREATEST_LESS_THAN_ONE 0.99999994
#define DISABLE_UNIFORMITY_ANALYSIS






const vec3 PoissonSamplers32[64]=vec3[64](
vec3(0.06407013,0.05409927,0.),
vec3(0.7366577,0.5789394,0.),
vec3(-0.6270542,-0.5320278,0.),
vec3(-0.4096107,0.8411095,0.),
vec3(0.6849564,-0.4990818,0.),
vec3(-0.874181,-0.04579735,0.),
vec3(0.9989998,0.0009880066,0.),
vec3(-0.004920578,-0.9151649,0.),
vec3(0.1805763,0.9747483,0.),
vec3(-0.2138451,0.2635818,0.),
vec3(0.109845,0.3884785,0.),
vec3(0.06876755,-0.3581074,0.),
vec3(0.374073,-0.7661266,0.),
vec3(0.3079132,-0.1216763,0.),
vec3(-0.3794335,-0.8271583,0.),
vec3(-0.203878,-0.07715034,0.),
vec3(0.5912697,0.1469799,0.),
vec3(-0.88069,0.3031784,0.),
vec3(0.5040108,0.8283722,0.),
vec3(-0.5844124,0.5494877,0.),
vec3(0.6017799,-0.1726654,0.),
vec3(-0.5554981,0.1559997,0.),
vec3(-0.3016369,-0.3900928,0.),
vec3(-0.5550632,-0.1723762,0.),
vec3(0.925029,0.2995041,0.),
vec3(-0.2473137,0.5538505,0.),
vec3(0.9183037,-0.2862392,0.),
vec3(0.2469421,0.6718712,0.),
vec3(0.3916397,-0.4328209,0.),
vec3(-0.03576927,-0.6220032,0.),
vec3(-0.04661255,0.7995201,0.),
vec3(0.4402924,0.3640312,0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.),
vec3(0.)
);
const vec3 PoissonSamplers64[64]=vec3[64](
vec3(-0.613392,0.617481,0.),
vec3(0.170019,-0.040254,0.),
vec3(-0.299417,0.791925,0.),
vec3(0.645680,0.493210,0.),
vec3(-0.651784,0.717887,0.),
vec3(0.421003,0.027070,0.),
vec3(-0.817194,-0.271096,0.),
vec3(-0.705374,-0.668203,0.),
vec3(0.977050,-0.108615,0.),
vec3(0.063326,0.142369,0.),
vec3(0.203528,0.214331,0.),
vec3(-0.667531,0.326090,0.),
vec3(-0.098422,-0.295755,0.),
vec3(-0.885922,0.215369,0.),
vec3(0.566637,0.605213,0.),
vec3(0.039766,-0.396100,0.),
vec3(0.751946,0.453352,0.),
vec3(0.078707,-0.715323,0.),
vec3(-0.075838,-0.529344,0.),
vec3(0.724479,-0.580798,0.),
vec3(0.222999,-0.215125,0.),
vec3(-0.467574,-0.405438,0.),
vec3(-0.248268,-0.814753,0.),
vec3(0.354411,-0.887570,0.),
vec3(0.175817,0.382366,0.),
vec3(0.487472,-0.063082,0.),
vec3(-0.084078,0.898312,0.),
vec3(0.488876,-0.783441,0.),
vec3(0.470016,0.217933,0.),
vec3(-0.696890,-0.549791,0.),
vec3(-0.149693,0.605762,0.),
vec3(0.034211,0.979980,0.),
vec3(0.503098,-0.308878,0.),
vec3(-0.016205,-0.872921,0.),
vec3(0.385784,-0.393902,0.),
vec3(-0.146886,-0.859249,0.),
vec3(0.643361,0.164098,0.),
vec3(0.634388,-0.049471,0.),
vec3(-0.688894,0.007843,0.),
vec3(0.464034,-0.188818,0.),
vec3(-0.440840,0.137486,0.),
vec3(0.364483,0.511704,0.),
vec3(0.034028,0.325968,0.),
vec3(0.099094,-0.308023,0.),
vec3(0.693960,-0.366253,0.),
vec3(0.678884,-0.204688,0.),
vec3(0.001801,0.780328,0.),
vec3(0.145177,-0.898984,0.),
vec3(0.062655,-0.611866,0.),
vec3(0.315226,-0.604297,0.),
vec3(-0.780145,0.486251,0.),
vec3(-0.371868,0.882138,0.),
vec3(0.200476,0.494430,0.),
vec3(-0.494552,-0.711051,0.),
vec3(0.612476,0.705252,0.),
vec3(-0.578845,-0.768792,0.),
vec3(-0.772454,-0.090976,0.),
vec3(0.504440,0.372295,0.),
vec3(0.155736,0.065157,0.),
vec3(0.391522,0.849605,0.),
vec3(-0.620106,-0.328104,0.),
vec3(0.789239,-0.419965,0.),
vec3(-0.545396,0.538133,0.),
vec3(-0.178564,-0.596057,0.)
);








#define CUSTOM_IMAGEPROCESSINGFUNCTIONS_DEFINITIONS
vec4 applyImageProcessing(vec4 result) {
#define CUSTOM_IMAGEPROCESSINGFUNCTIONS_UPDATERESULT_ATSTART
result.rgb=toGammaSpace(result.rgb);
result.rgb=saturate(result.rgb);
#define CUSTOM_IMAGEPROCESSINGFUNCTIONS_UPDATERESULT_ATEND
return result;
}
#define TEXRD(s,uv) texture(s,uv)
#define TEXRD_DEFINED
#define FOGMODE_NONE 0.
#define FOGMODE_EXP 1.
#define FOGMODE_EXP2 2.
#define FOGMODE_LINEAR 3.
#define E 2.71828


layout(location = 2)  in vec3 vFogDistance;
float CalcFogFactor()
{float fogCoeff=1.0;
float fogStart=vFogInfos.y;
float fogEnd=vFogInfos.z;
float fogDensity=vFogInfos.w;
float fogDistance=length(vFogDistance);
if (FOGMODE_LINEAR==vFogInfos.x)
{fogCoeff=(fogEnd-fogDistance)/(fogEnd-fogStart);
}
else if (FOGMODE_EXP==vFogInfos.x)
{fogCoeff=1.0/pow(E,fogDistance*fogDensity);
}
else if (FOGMODE_EXP2==vFogInfos.x)
{fogCoeff=1.0/pow(E,fogDistance*fogDistance*fogDensity*fogDensity);
}
return clamp(fogCoeff,0.0,1.0);
}
#define CUSTOM_FRAGMENT_DEFINITIONS
layout(location = 0) out vec4 glFragColor;
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
vec3 viewDirectionW=normalize(vEyePosition.xyz-vPositionW);
vec4 baseColor=vec4(1.,1.,1.,1.);
vec3 diffuseColor=vDiffuseColor.rgb;
float alpha=vDiffuseColor.a;
vec3 normalW=normalize(vNormalW);
vec2 uvOffset=vec2(0.0,0.0);
#define CUSTOM_FRAGMENT_UPDATE_DIFFUSE
vec3 baseAmbientColor=vec3(1.,1.,1.);
#define CUSTOM_FRAGMENT_BEFORE_LIGHTS
float glossiness=vSpecularColor.a;
vec3 specularColor=vSpecularColor.rgb;
vec3 diffuseBase=vec3(0.,0.,0.);
lightingInfo info;
vec3 specularBase=vec3(0.,0.,0.);
float shadow=1.;
float aggShadow=0.;
float numLights=0.;
vec4 diffuse0=light0.vLightDiffuse;
#define CUSTOM_LIGHT0_COLOR 
info=computeSpotLighting(viewDirectionW,normalW,light0.vLightData,light0.vLightDirection,diffuse0.rgb,light0.vLightSpecular.rgb,diffuse0.a,glossiness);
shadow=1.;
aggShadow+=shadow;
numLights+=1.0;
diffuseBase+=info.diffuse*shadow;
specularBase+=info.specular*shadow;
vec4 diffuse1=light1.vLightDiffuse;
#define CUSTOM_LIGHT1_COLOR 
info=computeLighting(viewDirectionW,normalW,light1.vLightData,diffuse1.rgb,light1.vLightSpecular.rgb,diffuse1.a,glossiness);
for (int i=0;
i<SHADOWCSMNUM_CASCADES1;
i++)
{
diff1=viewFrustumZ1[i]-vPositionFromCamera1.z;
if (diff1>=0.) {index1=i;
break;
}}
if (index1>=0)
{
float computeShadowWithCSMPCF5_0;
{vec3 clipSpace=vPositionFromLight1[index1].xyz/vPositionFromLight1[index1].w;
vec3 uvDepth=vec3(0.5*clipSpace.xyz+vec3(0.5));
uvDepth.z=clamp(ZINCLIP,0.,GREATEST_LESS_THAN_ONE);
vec2 uv=uvDepth.xy*light1.shadowsInfo.yz.x;
uv+=0.5;
vec2 st=fract(uv);
vec2 base_uv=floor(uv)-0.5;
base_uv*=light1.shadowsInfo.yz.y;
vec2 uvw0=4.-3.*st;
vec2 uvw1=vec2(7.);
vec2 uvw2=1.+3.*st;
vec3 u=vec3((3.-2.*st.x)/uvw0.x-2.,(3.+st.x)/uvw1.x,st.x/uvw2.x+2.)*light1.shadowsInfo.yz.y;
vec3 v=vec3((3.-2.*st.y)/uvw0.y-2.,(3.+st.y)/uvw1.y,st.y/uvw2.y+2.)*light1.shadowsInfo.yz.y;
float shadow=0.;
shadow+=uvw0.x*uvw0.y*texture(shadowTexture1,vec4(base_uv.xy+vec2(u[0],v[0]),float(index1),uvDepth.z));
shadow+=uvw1.x*uvw0.y*texture(shadowTexture1,vec4(base_uv.xy+vec2(u[1],v[0]),float(index1),uvDepth.z));
shadow+=uvw2.x*uvw0.y*texture(shadowTexture1,vec4(base_uv.xy+vec2(u[2],v[0]),float(index1),uvDepth.z));
shadow+=uvw0.x*uvw1.y*texture(shadowTexture1,vec4(base_uv.xy+vec2(u[0],v[1]),float(index1),uvDepth.z));
shadow+=uvw1.x*uvw1.y*texture(shadowTexture1,vec4(base_uv.xy+vec2(u[1],v[1]),float(index1),uvDepth.z));
shadow+=uvw2.x*uvw1.y*texture(shadowTexture1,vec4(base_uv.xy+vec2(u[2],v[1]),float(index1),uvDepth.z));
shadow+=uvw0.x*uvw2.y*texture(shadowTexture1,vec4(base_uv.xy+vec2(u[0],v[2]),float(index1),uvDepth.z));
shadow+=uvw1.x*uvw2.y*texture(shadowTexture1,vec4(base_uv.xy+vec2(u[1],v[2]),float(index1),uvDepth.z));
shadow+=uvw2.x*uvw2.y*texture(shadowTexture1,vec4(base_uv.xy+vec2(u[2],v[2]),float(index1),uvDepth.z));
shadow=shadow/144.;
shadow=mix(light1.shadowsInfo.x,1.,shadow);
computeShadowWithCSMPCF5_0 = computeFallOff(shadow,clipSpace.xy,light1.shadowsInfo.w);
}
shadow=computeShadowWithCSMPCF5_0;
float frustumLength=frustumLengths1[index1];
float diffRatio=clamp(diff1/frustumLength,0.,1.)*cascadeBlendFactor1;
if (index1<(SHADOWCSMNUM_CASCADES1-1) && diffRatio<1.)
{index1+=1;
float nextShadow=0.;
float computeShadowWithCSMPCF5_1;
{vec3 clipSpace=vPositionFromLight1[index1].xyz/vPositionFromLight1[index1].w;
vec3 uvDepth=vec3(0.5*clipSpace.xyz+vec3(0.5));
uvDepth.z=clamp(ZINCLIP,0.,GREATEST_LESS_THAN_ONE);
vec2 uv=uvDepth.xy*light1.shadowsInfo.yz.x;
uv+=0.5;
vec2 st=fract(uv);
vec2 base_uv=floor(uv)-0.5;
base_uv*=light1.shadowsInfo.yz.y;
vec2 uvw0=4.-3.*st;
vec2 uvw1=vec2(7.);
vec2 uvw2=1.+3.*st;
vec3 u=vec3((3.-2.*st.x)/uvw0.x-2.,(3.+st.x)/uvw1.x,st.x/uvw2.x+2.)*light1.shadowsInfo.yz.y;
vec3 v=vec3((3.-2.*st.y)/uvw0.y-2.,(3.+st.y)/uvw1.y,st.y/uvw2.y+2.)*light1.shadowsInfo.yz.y;
float shadow=0.;
shadow+=uvw0.x*uvw0.y*texture(shadowTexture1,vec4(base_uv.xy+vec2(u[0],v[0]),float(index1),uvDepth.z));
shadow+=uvw1.x*uvw0.y*texture(shadowTexture1,vec4(base_uv.xy+vec2(u[1],v[0]),float(index1),uvDepth.z));
shadow+=uvw2.x*uvw0.y*texture(shadowTexture1,vec4(base_uv.xy+vec2(u[2],v[0]),float(index1),uvDepth.z));
shadow+=uvw0.x*uvw1.y*texture(shadowTexture1,vec4(base_uv.xy+vec2(u[0],v[1]),float(index1),uvDepth.z));
shadow+=uvw1.x*uvw1.y*texture(shadowTexture1,vec4(base_uv.xy+vec2(u[1],v[1]),float(index1),uvDepth.z));
shadow+=uvw2.x*uvw1.y*texture(shadowTexture1,vec4(base_uv.xy+vec2(u[2],v[1]),float(index1),uvDepth.z));
shadow+=uvw0.x*uvw2.y*texture(shadowTexture1,vec4(base_uv.xy+vec2(u[0],v[2]),float(index1),uvDepth.z));
shadow+=uvw1.x*uvw2.y*texture(shadowTexture1,vec4(base_uv.xy+vec2(u[1],v[2]),float(index1),uvDepth.z));
shadow+=uvw2.x*uvw2.y*texture(shadowTexture1,vec4(base_uv.xy+vec2(u[2],v[2]),float(index1),uvDepth.z));
shadow=shadow/144.;
shadow=mix(light1.shadowsInfo.x,1.,shadow);
computeShadowWithCSMPCF5_1 = computeFallOff(shadow,clipSpace.xy,light1.shadowsInfo.w);
}
nextShadow=computeShadowWithCSMPCF5_1;
shadow=mix(nextShadow,shadow,diffRatio);
}
}
aggShadow+=shadow;
numLights+=1.0;
diffuseBase+=info.diffuse*shadow;
specularBase+=info.specular*shadow;
vec4 diffuse2=light2.vLightDiffuse;
#define CUSTOM_LIGHT2_COLOR 
info=computeHemisphericLighting(viewDirectionW,normalW,light2.vLightData,diffuse2.rgb,light2.vLightSpecular.rgb,light2.vLightGround,glossiness);
shadow=1.;
aggShadow+=shadow;
numLights+=1.0;
diffuseBase+=info.diffuse*shadow;
specularBase+=info.specular*shadow;
aggShadow=aggShadow/numLights;
vec4 refractionColor=vec4(0.,0.,0.,1.);
vec4 reflectionColor=vec4(0.,0.,0.,1.);
vec3 emissiveColor=vEmissiveColor;
vec3 finalDiffuse=clamp(diffuseBase*diffuseColor+emissiveColor+vAmbientColor,0.0,1.0)*baseColor.rgb;
vec3 finalSpecular=specularBase*specularColor;
vec4 color=vec4(finalDiffuse*baseAmbientColor+finalSpecular+reflectionColor.rgb+refractionColor.rgb,alpha);
#define CUSTOM_FRAGMENT_BEFORE_FOG
color.rgb=max(color.rgb,0.);
float fog=CalcFogFactor();
color.rgb=mix(vFogColor,color.rgb,fog);
color.rgb=toLinearSpace(color.rgb);
color.a*=visibility;
#define CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR
glFragColor=color;
#define CUSTOM_FRAGMENT_MAIN_END
}
