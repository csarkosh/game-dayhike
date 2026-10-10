#version 450
#define MATERIALPLUGIN_18
#define BRDF_V_HEIGHT_CORRELATED
#define MS_BRDF_ENERGY_CONSERVATION
#define SPHERICAL_HARMONICS
#define SPECULAR_GLOSSINESS_ENERGY_CONSERVATION
#define MIX_IBL_RADIANCE_WITH_IRRADIANCE
#define LEGACY_SPECULAR_ENERGY_CONSERVATION
#define BASE_DIFFUSE_MODEL 0
#define DIELECTRIC_SPECULAR_MODEL 0
#define CONDUCTOR_SPECULAR_MODEL 0
#define CLEARCOAT_TEXTUREDIRECTUV 0
#define CLEARCOAT_TEXTURE_ROUGHNESSDIRECTUV 0
#define CLEARCOAT_BUMPDIRECTUV 0
#define CLEARCOAT_TINT_TEXTUREDIRECTUV 0
#define IRIDESCENCE_TEXTUREDIRECTUV 0
#define IRIDESCENCE_THICKNESS_TEXTUREDIRECTUV 0
#define ANISOTROPIC_TEXTUREDIRECTUV 0
#define SHEEN_TEXTUREDIRECTUV 0
#define SHEEN_TEXTURE_ROUGHNESSDIRECTUV 0
#define SS_THICKNESSANDMASK_TEXTUREDIRECTUV 0
#define SS_REFRACTIONINTENSITY_TEXTUREDIRECTUV 0
#define SS_TRANSLUCENCYINTENSITY_TEXTUREDIRECTUV 0
#define SS_TRANSLUCENCYCOLOR_TEXTUREDIRECTUV 0
#define DETAILDIRECTUV 0
#define DETAIL_NORMALBLENDMETHOD 0
#define WET
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
#define PBR
#define NUM_SAMPLES 0
#define ALBEDODIRECTUV 0
#define BASE_WEIGHTDIRECTUV 0
#define BASE_DIFFUSE_ROUGHNESSDIRECTUV 0
#define AMBIENTDIRECTUV 0
#define OPACITYDIRECTUV 0
#define ALPHATESTVALUE 0.4
#define SPECULAROVERALPHA
#define RADIANCEOVERALPHA
#define EMISSIVEDIRECTUV 0
#define REFLECTIVITYDIRECTUV 0
#define SPECULARTERM
#define LODBASEDMICROSFURACE
#define MICROSURFACEMAPDIRECTUV 0
#define METALLICWORKFLOW
#define METALLIC_REFLECTANCEDIRECTUV 0
#define REFLECTANCEDIRECTUV 0
#define ENVIRONMENTBRDF
#define NORMAL
#define BUMPDIRECTUV 0
#define NORMALXYSCALE
#define LIGHTMAPDIRECTUV 0
#define REFLECTION
#define REFLECTIONMAP_3D
#define REFLECTIONMAP_CUBIC
#define INVERTCUBICMAP
#define USESPHERICALFROMREFLECTIONMAP
#define USESPHERICALINVERTEX
#define GAMMAREFLECTION
#define RADIANCEOCCLUSION
#define HORIZONOCCLUSION
#define INSTANCES
#define THIN_INSTANCES
#define NUM_BONE_INFLUENCERS 0
#define BonesPerMesh 0
#define NUM_MORPH_INFLUENCERS 0
#define ORDER_INDEPENDENT_TRANSPARENCY_16BITS
#define USEPHYSICALLIGHTFALLOFF
#define FOG
#define CAMERA_PERSPECTIVE
#define AREALIGHTSUPPORTED
#define SPECULARAA
#define TEXTURE_REPETITION_MODE 0
#define DEBUGMODE 0
#define VERTEX_PULLING_USE_INDEX_BUFFER
#define CLUSTLIGHT_SLICES 0
#define CLUSTLIGHT_BATCH 0
#define LIGHT0
#define SPOTLIGHT0
#define LIGHT1
#define DIRLIGHT1
#define LIGHT2
#define HEMILIGHT2
#define LIGHTCOUNT 3
#define MAXLIGHTCOUNT 7

#define SHADER_NAME fragment:pbr
layout(set = 1, binding = 12) uniform LeftOver {
        vec4 vFogInfos;
    vec3 vFogColor;
};

// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};

#define PBR_FRAGMENT_SHADER
#define CUSTOM_FRAGMENT_EXTENSION


#define CUSTOM_FRAGMENT_BEGIN
precision highp float;
#define FROMLINEARSPACE
layout(std140,column_major) uniform;
layout(set = 1, binding = 1) uniform Material {vec2 vAlbedoInfos;
vec2 vBaseWeightInfos;
vec2 vBaseDiffuseRoughnessInfos;
vec4 vAmbientInfos;
vec2 vOpacityInfos;
vec2 vEmissiveInfos;
vec2 vLightmapInfos;
vec3 vReflectivityInfos;
vec2 vMicroSurfaceSamplerInfos;
vec3 vBumpInfos;
mat4 albedoMatrix;
mat4 baseWeightMatrix;
mat4 baseDiffuseRoughnessMatrix;
mat4 ambientMatrix;
mat4 opacityMatrix;
mat4 emissiveMatrix;
mat4 lightmapMatrix;
mat4 reflectivityMatrix;
mat4 microSurfaceSamplerMatrix;
mat4 bumpMatrix;
vec2 vTangentSpaceParams;
vec4 vAlbedoColor;
float baseWeight;
float baseDiffuseRoughness;
vec4 vLightingIntensity;
float pointSize;
vec4 vReflectivityColor;
vec3 vEmissiveColor;
vec3 vAmbientColor;
vec2 vDebugMode;
vec4 vMetallicReflectanceFactors;
vec2 vMetallicReflectanceInfos;
mat4 metallicReflectanceMatrix;
vec2 vReflectanceInfos;
mat4 reflectanceMatrix;
vec4 cameraInfo;
vec4 vTextureRepetitionHexTilingParams;
vec2 vReflectionInfos;
mat4 reflectionMatrix;
vec3 vReflectionMicrosurfaceInfos;
vec3 vReflectionPosition;
vec3 vReflectionSize;
vec2 vReflectionFilteringInfo;
vec3 vReflectionDominantDirection;
vec3 vReflectionColor;
vec3 vSphericalL00;
vec3 vSphericalL1_1;
vec3 vSphericalL10;
vec3 vSphericalL11;
vec3 vSphericalL2_2;
vec3 vSphericalL2_1;
vec3 vSphericalL20;
vec3 vSphericalL21;
vec3 vSphericalL22;
vec3 vSphericalX;
vec3 vSphericalY;
vec3 vSphericalZ;
vec3 vSphericalXX_ZZ;
vec3 vSphericalYY_ZZ;
vec3 vSphericalZZ;
vec3 vSphericalXY;
vec3 vSphericalYZ;
vec3 vSphericalZX;
vec2 vClearCoatParams;
vec4 vClearCoatRefractionParams;
vec4 vClearCoatInfos;
mat4 clearCoatMatrix;
mat4 clearCoatRoughnessMatrix;
vec2 vClearCoatBumpInfos;
vec2 vClearCoatTangentSpaceParams;
mat4 clearCoatBumpMatrix;
vec4 vClearCoatTintParams;
float clearCoatColorAtDistance;
vec2 vClearCoatTintInfos;
mat4 clearCoatTintMatrix;
vec4 vIridescenceParams;
vec4 vIridescenceInfos;
mat4 iridescenceMatrix;
mat4 iridescenceThicknessMatrix;
vec3 vAnisotropy;
vec2 vAnisotropyInfos;
mat4 anisotropyMatrix;
vec4 vSheenColor;
float vSheenRoughness;
vec4 vSheenInfos;
mat4 sheenMatrix;
mat4 sheenRoughnessMatrix;
vec4 vRefractionMicrosurfaceInfos;
vec2 vRefractionFilteringInfo;
vec2 vTranslucencyIntensityInfos;
vec4 vRefractionInfos;
mat4 refractionMatrix;
vec2 vThicknessInfos;
vec2 vRefractionIntensityInfos;
mat4 thicknessMatrix;
mat4 refractionIntensityMatrix;
mat4 translucencyIntensityMatrix;
vec2 vThicknessParam;
vec3 vDiffusionDistance;
vec4 vTintColor;
vec3 vSubSurfaceIntensity;
vec3 vRefractionPosition;
vec3 vRefractionSize;
float scatteringDiffusionProfile;
float dispersion;
vec4 vTranslucencyColor;
vec2 vTranslucencyColorInfos;
mat4 translucencyColorMatrix;
vec4 vDetailInfos;
mat4 detailMatrix;
float atmOn;
float atmHeightDensity;
float atmHeightFalloff;
float atmReferenceLevel;
float atmGradientScale;
float atmSunPower;
float atmSunWeight;
vec3 atmSunDir;
vec3 atmSunColour;
vec3 atmFarColour;
float atmCloudDensity;
float atmCloudSteps;
float atmCloudRange;
float atmCloudFalloff;
float atmCloudSeat;
float atmCloudGroundRange;
float atmCloudNear;
float atmCloudTrail;
vec2 atmCloudNoiseScale;
vec2 atmCloudWind;
vec2 atmCloudGlow;
vec3 atmCloudColour;
vec4 atmCloudGroundRect;
float wetLine;
float wetLevel;
vec2 wetCentre;
float wetRadius;
vec3 wetKd;
float wetAttenuate;
float wetWeather;
float wetCap;
vec4 wetCove;
vec4 wetSwash[256];
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
layout(location = 0)  in vec3 vPositionW;
layout(location = 1)  in vec3 vNormalW;
layout(location = 2)  in vec3 vEnvironmentIrradiance;
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
layout(set = 1, binding = 5) uniform Light2
{vec4 vLightData;
vec4 vLightDiffuse;
vec4 vLightSpecular;
vec3 vLightGround;
vec4 shadowsInfo;
vec2 depthValues;
} light2;
#define sampleReflection(s,c) texture(s,c)
layout(set = 1, binding = 7) uniform sampler reflectionSamplerSampler;
                        layout(set = 1, binding = 6) uniform textureCube reflectionSamplerTexture;
                        #define reflectionSampler samplerCube(reflectionSamplerTexture, reflectionSamplerSampler)
#define sampleReflectionLod(s,c,l) textureLod(s,c,l)
layout(set = 1, binding = 9) uniform sampler environmentBrdfSamplerSampler;
                        layout(set = 1, binding = 8) uniform texture2D environmentBrdfSamplerTexture;
                        #define environmentBrdfSampler sampler2D(environmentBrdfSamplerTexture, environmentBrdfSamplerSampler)
#define FOGMODE_NONE 0.
#define FOGMODE_EXP 1.
#define FOGMODE_EXP2 2.
#define FOGMODE_LINEAR 3.
#define E 2.71828


layout(location = 3)  in vec3 vFogDistance;
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
#define TEXRD(s,uv) texture(s,uv)
#define TEXRD_DEFINED
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
bool testLightingForSSS(float diffusionProfile)
{return diffusionProfile<1.;
}
vec3 hemisphereCosSample(vec2 u) {float phi=2.*PI*u.x;
float cosTheta2=1.-u.y;
float cosTheta=sqrt(cosTheta2);
float sinTheta=sqrt(1.-cosTheta2);
return vec3(sinTheta*cos(phi),sinTheta*sin(phi),cosTheta);
}
vec3 hemisphereImportanceSampleDggx(vec2 u,float a) {float phi=2.*PI*u.x;
float cosTheta2=(1.-u.y)/(1.+(a+1.)*((a-1.)*u.y));
float cosTheta=sqrt(cosTheta2);
float sinTheta=sqrt(1.-cosTheta2);
return vec3(sinTheta*cos(phi),sinTheta*sin(phi),cosTheta);
}
vec3 hemisphereImportanceSampleDggxAnisotropic(vec2 Xi,float alphaTangent,float alphaBitangent)
{alphaTangent=max(alphaTangent,0.0001);
alphaBitangent=max(alphaBitangent,0.0001);
float phi=atan(alphaBitangent/alphaTangent*tan(2.0*3.14159265*Xi.x));
if (Xi.x>0.5) phi+=3.14159265;
float cosPhi=cos(phi);
float sinPhi=sin(phi);
float alpha2=(cosPhi*cosPhi)/(alphaTangent*alphaTangent) +
(sinPhi*sinPhi)/(alphaBitangent*alphaBitangent);
float tanTheta2=Xi.y/(1.0-Xi.y)/alpha2;
float cosTheta=1.0/sqrt(1.0+tanTheta2);
float sinTheta=sqrt(max(0.0,1.0-cosTheta*cosTheta));
return vec3(sinTheta*cosPhi,sinTheta*sinPhi,cosTheta);
}
vec3 hemisphereImportanceSampleDCharlie(vec2 u,float a) {
float phi=2.*PI*u.x;
float sinTheta=pow(u.y,a/(2.*a+1.));
float cosTheta=sqrt(1.-sinTheta*sinTheta);
return vec3(sinTheta*cos(phi),sinTheta*sin(phi),cosTheta);
}
#define MINIMUMVARIANCE 0.0005
float convertRoughnessToAverageSlope(float roughness)
{return square(roughness)+MINIMUMVARIANCE;
}
float fresnelGrazingReflectance(float reflectance0) {float reflectance90=saturate(reflectance0*25.0);
return reflectance90;
}
vec2 getAARoughnessFactors(vec3 normalVector) {
vec3 nDfdx=dFdx(normalVector.xyz);
vec3 nDfdy=(-yFactor_)*dFdy(normalVector.xyz);
float slopeSquare=max(dot(nDfdx,nDfdx),dot(nDfdy,nDfdy));
float geometricRoughnessFactor=pow(saturate(slopeSquare),0.333);
float geometricAlphaGFactor=sqrt(slopeSquare);
geometricAlphaGFactor*=0.75;
return vec2(geometricRoughnessFactor,geometricAlphaGFactor);
}
#define CUSTOM_IMAGEPROCESSINGFUNCTIONS_DEFINITIONS
vec4 applyImageProcessing(vec4 result) {
#define CUSTOM_IMAGEPROCESSINGFUNCTIONS_UPDATERESULT_ATSTART
result.rgb=toGammaSpace(result.rgb);
result.rgb=saturate(result.rgb);
#define CUSTOM_IMAGEPROCESSINGFUNCTIONS_UPDATERESULT_ATEND
return result;
}
vec3 computeEnvironmentIrradiance(vec3 normal) {return vSphericalL00
+ vSphericalL1_1*(normal.y)
+ vSphericalL10*(normal.z)
+ vSphericalL11*(normal.x)
+ vSphericalL2_2*(normal.y*normal.x)
+ vSphericalL2_1*(normal.y*normal.z)
+ vSphericalL20*((3.0*normal.z*normal.z)-1.0)
+ vSphericalL21*(normal.z*normal.x)
+ vSphericalL22*(normal.x*normal.x-(normal.y*normal.y));
}
struct preLightingInfo
{vec3 lightOffset;
float lightDistanceSquared;
float lightDistance;
float attenuation;
vec3 L;
vec3 H;
float NdotV;
float NdotLUnclamped;
float NdotL;
float VdotH;
float LdotV;
float roughness;
float diffuseRoughness;
vec3 surfaceAlbedo;
};
preLightingInfo computePointAndSpotPreLightingInfo(vec4 lightData,vec3 V,vec3 N,vec3 posW) {preLightingInfo result;
result.lightOffset=lightData.xyz-posW;
result.lightDistanceSquared=dot(result.lightOffset,result.lightOffset);
result.lightDistance=sqrt(result.lightDistanceSquared);
result.L=normalize(result.lightOffset);
result.H=normalize(V+result.L);
result.VdotH=saturate(dot(V,result.H));
result.NdotLUnclamped=dot(N,result.L);
result.NdotL=saturateEps(result.NdotLUnclamped);
result.LdotV=0.;
result.roughness=0.;
result.diffuseRoughness=0.;
result.surfaceAlbedo=vec3(0.);
return result;
}
preLightingInfo computeDirectionalPreLightingInfo(vec4 lightData,vec3 V,vec3 N) {preLightingInfo result;
result.lightDistance=length(-lightData.xyz);
result.L=normalize(-lightData.xyz);
result.H=normalize(V+result.L);
result.VdotH=saturate(dot(V,result.H));
result.NdotLUnclamped=dot(N,result.L);
result.NdotL=saturateEps(result.NdotLUnclamped);
result.LdotV=dot(result.L,V);
result.roughness=0.;
result.diffuseRoughness=0.;
result.surfaceAlbedo=vec3(0.);
return result;
}
preLightingInfo computeHemisphericPreLightingInfo(vec4 lightData,vec3 V,vec3 N) {preLightingInfo result;
result.NdotL=dot(N,lightData.xyz)*0.5+0.5;
result.NdotL=saturateEps(result.NdotL);
result.NdotLUnclamped=result.NdotL;
result.L=normalize(lightData.xyz);
result.H=normalize(V+result.L);
result.VdotH=saturate(dot(V,result.H));
result.LdotV=0.;
result.roughness=0.;
result.diffuseRoughness=0.;
result.surfaceAlbedo=vec3(0.);
return result;
}
float computeDistanceLightFalloff_Standard(vec3 lightOffset,float range)
{return max(0.,1.0-length(lightOffset)/range);
}
float computeDistanceLightFalloff_Physical(float lightDistanceSquared)
{return 1.0/maxEps(lightDistanceSquared);
}
float computeDistanceLightFalloff_GLTF(float lightDistanceSquared,float inverseSquaredRange)
{float lightDistanceFalloff=1.0/maxEps(lightDistanceSquared);
float factor=lightDistanceSquared*inverseSquaredRange;
float attenuation=saturate(1.0-factor*factor);
attenuation*=attenuation;
lightDistanceFalloff*=attenuation;
return lightDistanceFalloff;
}
float computeDistanceLightFalloff(vec3 lightOffset,float lightDistanceSquared,float range,float inverseSquaredRange)
{
return computeDistanceLightFalloff_Physical(lightDistanceSquared);
}
float computeDirectionalLightFalloff_Standard(vec3 lightDirection,vec3 directionToLightCenterW,float cosHalfAngle,float exponent)
{float falloff=0.0;
float cosAngle=maxEps(dot(-lightDirection,directionToLightCenterW));
if (cosAngle>=cosHalfAngle)
{falloff=max(0.,pow(cosAngle,exponent));
}
return falloff;
}
float computeDirectionalLightFalloff_IES(vec3 lightDirection,vec3 directionToLightCenterW,sampler2D iesLightSampler)
{float cosAngle=dot(-lightDirection,directionToLightCenterW);
float angle=acos(cosAngle)/PI;
return texture(iesLightSampler,vec2(angle,0.)).r;
}
float computeDirectionalLightFalloff_Physical(vec3 lightDirection,vec3 directionToLightCenterW,float cosHalfAngle)
{const float kMinusLog2ConeAngleIntensityRatio=6.64385618977;
float concentrationKappa=kMinusLog2ConeAngleIntensityRatio/(1.0-cosHalfAngle);
vec4 lightDirectionSpreadSG=vec4(-lightDirection*concentrationKappa,-concentrationKappa);
float falloff=exp2(dot(vec4(directionToLightCenterW,1.0),lightDirectionSpreadSG));
return falloff;
}
float computeDirectionalLightFalloff_GLTF(vec3 lightDirection,vec3 directionToLightCenterW,float lightAngleScale,float lightAngleOffset)
{float cd=dot(-lightDirection,directionToLightCenterW);
float falloff=saturate(cd*lightAngleScale+lightAngleOffset);
falloff*=falloff;
return falloff;
}
float computeDirectionalLightFalloff(vec3 lightDirection,vec3 directionToLightCenterW,float cosHalfAngle,float exponent,float lightAngleScale,float lightAngleOffset)
{
return computeDirectionalLightFalloff_Physical(lightDirection,directionToLightCenterW,cosHalfAngle);
}
#define FRESNEL_MAXIMUM_ON_ROUGH 0.25
#define BRDF_DIFFUSE_MODEL_EON 0
#define BRDF_DIFFUSE_MODEL_BURLEY 1
#define BRDF_DIFFUSE_MODEL_LAMBERT 2
#define BRDF_DIFFUSE_MODEL_LEGACY 3
#define DIELECTRIC_SPECULAR_MODEL_GLTF 0
#define DIELECTRIC_SPECULAR_MODEL_OPENPBR 1
#define CONDUCTOR_SPECULAR_MODEL_GLTF 0
#define CONDUCTOR_SPECULAR_MODEL_OPENPBR 1
vec3 getEnergyConservationFactor(const vec3 specularEnvironmentR0,const vec3 environmentBrdf) {return 1.0+specularEnvironmentR0*(1.0/environmentBrdf.y-1.0);
}
vec3 getBRDFLookup(float NdotV,float perceptualRoughness) {vec2 UV=vec2(NdotV,perceptualRoughness);
vec4 brdfLookup=texture(environmentBrdfSampler,UV);
return brdfLookup.rgb;
}
vec3 getReflectanceFromBRDFLookup(const vec3 specularEnvironmentR0,const vec3 specularEnvironmentR90,const vec3 environmentBrdf) {
vec3 reflectance=(specularEnvironmentR90-specularEnvironmentR0)*environmentBrdf.x+specularEnvironmentR0*environmentBrdf.y;
return reflectance;
}
vec3 getReflectanceFromBRDFLookup(const vec3 specularEnvironmentR0,const vec3 environmentBrdf) {
vec3 reflectance=mix(environmentBrdf.xxx,environmentBrdf.yyy,specularEnvironmentR0);
return reflectance;
}
/* NOT USED
*/
vec3 fresnelSchlickGGX(float VdotH,vec3 reflectance0,vec3 reflectance90)
{return reflectance0+(reflectance90-reflectance0)*pow5(1.0-VdotH);
}
float fresnelSchlickGGX(float VdotH,float reflectance0,float reflectance90)
{return reflectance0+(reflectance90-reflectance0)*pow5(1.0-VdotH);
}
float normalDistributionFunction_TrowbridgeReitzGGX(float NdotH,float alphaG)
{float a2=square(alphaG);
float d=NdotH*NdotH*(a2-1.0)+1.0;
return a2/(PI*d*d);
}
float smithVisibility_GGXCorrelated(float NdotL,float NdotV,float alphaG) {
float a2=alphaG*alphaG;
float GGXV=NdotL*sqrt(NdotV*(NdotV-a2*NdotV)+a2);
float GGXL=NdotV*sqrt(NdotL*(NdotL-a2*NdotL)+a2);
return 0.5/(GGXV+GGXL);
}
float diffuseBRDF_Burley(float NdotL,float NdotV,float VdotH,float roughness) {float diffuseFresnelNV=pow5(saturateEps(1.0-NdotL));
float diffuseFresnelNL=pow5(saturateEps(1.0-NdotV));
float diffuseFresnel90=0.5+2.0*VdotH*VdotH*roughness;
float fresnel =
(1.0+(diffuseFresnel90-1.0)*diffuseFresnelNL) *
(1.0+(diffuseFresnel90-1.0)*diffuseFresnelNV);
return fresnel/PI;
}
const float constant1_FON=0.5-2.0/(3.0*PI);
const float constant2_FON=2.0/3.0-28.0/(15.0*PI);
float E_FON_approx(float mu,float roughness)
{float sigma=roughness;
float mucomp=1.0-mu;
float mucomp2=mucomp*mucomp;
const mat2 Gcoeffs=mat2(0.0571085289,-0.332181442,
0.491881867,0.0714429953);
float GoverPi=dot(Gcoeffs*vec2(mucomp,mucomp2),vec2(1.0,mucomp2));
return (1.0+sigma*GoverPi)/(1.0+constant1_FON*sigma);
}
vec3 diffuseBRDF_EON(vec3 albedo,float roughness,float NdotL,float NdotV,float LdotV)
{vec3 rho=albedo;
float sigma=roughness;
float mu_i=NdotL;
float mu_o=NdotV;
float s=LdotV-mu_i*mu_o;
float sovertF=s>0.0 ? s/max(mu_i,mu_o) : s;
float AF=1.0/(1.0+constant1_FON*sigma);
vec3 f_ss=(rho*RECIPROCAL_PI)*AF*(1.0+sigma*sovertF);
float EFo=E_FON_approx(mu_o,sigma);
float EFi=E_FON_approx(mu_i,sigma);
float avgEF=AF*(1.0+constant2_FON*sigma);
vec3 rho_ms=(rho*rho)*avgEF/(vec3(1.0)-rho*(1.0-avgEF));
const float eps=1.0e-7;
vec3 f_ms=(rho_ms*RECIPROCAL_PI)*max(eps,1.0-EFo)
* max(eps,1.0-EFi)
/ max(eps,1.0-avgEF);
return (f_ss+f_ms);
}
#define CLEARCOATREFLECTANCE90 1.0
struct lightingInfo
{vec3 diffuse;
vec3 specular;
};
float adjustRoughnessFromLightProperties(float roughness,float lightRadius,float lightDistance) {
float lightRoughness=lightRadius/lightDistance;
float totalRoughness=saturate(lightRoughness+roughness);
return totalRoughness;
}
vec3 computeHemisphericDiffuseLighting(preLightingInfo info,vec3 lightColor,vec3 groundColor) {return mix(groundColor,lightColor,info.NdotL);
}
vec3 computeDiffuseLighting(preLightingInfo info,vec3 lightColor) {vec3 diffuseTerm=vec3(1.0/PI);
vec3 clampedAlbedo=clamp(info.surfaceAlbedo,vec3(0.1),vec3(1.0));
diffuseTerm=diffuseBRDF_EON(clampedAlbedo,info.diffuseRoughness,info.NdotL,info.NdotV,info.LdotV);
diffuseTerm/=clampedAlbedo;
return diffuseTerm*info.attenuation*info.NdotL*lightColor;
}

vec3 computeSpecularLighting(preLightingInfo info,vec3 N,vec3 reflectance0,vec3 fresnel,float geometricRoughnessFactor,vec3 lightColor) {float NdotH=saturateEps(dot(N,info.H));
float roughness=max(info.roughness,geometricRoughnessFactor);
float alphaG=convertRoughnessToAverageSlope(roughness);
float distribution=normalDistributionFunction_TrowbridgeReitzGGX(NdotH,alphaG);
float smithVisibility=smithVisibility_GGXCorrelated(info.NdotL,info.NdotV,alphaG);
vec3 specTerm=fresnel*distribution*smithVisibility;
return specTerm*info.attenuation*info.NdotL*lightColor;
}
float getLodFromAlphaG(float cubeMapDimensionPixels,float microsurfaceAverageSlope) {float microsurfaceAverageSlopeTexels=cubeMapDimensionPixels*microsurfaceAverageSlope;
float lod=log2(microsurfaceAverageSlopeTexels);
return lod;
}
float getLinearLodFromRoughness(float cubeMapDimensionPixels,float roughness) {float lod=log2(cubeMapDimensionPixels)*roughness;
return lod;
}
float environmentRadianceOcclusion(float ambientOcclusion,float NdotVUnclamped) {float temp=NdotVUnclamped+ambientOcclusion;
return saturate(square(temp)-1.0+ambientOcclusion);
}
float environmentHorizonOcclusion(vec3 view,vec3 normal,vec3 geometricNormal) {vec3 reflection=reflect(view,normal);
float temp=saturate(1.0+1.1*dot(reflection,geometricNormal));
return square(temp);
}
vec3 computeFixedEquirectangularCoords(vec4 worldPos,vec3 worldNormal,vec3 direction)
{float lon=atan(direction.z,direction.x);
float lat=acos(direction.y);
vec2 sphereCoords=vec2(lon,lat)*RECIPROCAL_PI2*2.0;
float s=sphereCoords.x*0.5+0.5;
float t=sphereCoords.y;
return vec3(s,t,0);
}
vec3 computeMirroredFixedEquirectangularCoords(vec4 worldPos,vec3 worldNormal,vec3 direction)
{float lon=atan(direction.z,direction.x);
float lat=acos(direction.y);
vec2 sphereCoords=vec2(lon,lat)*RECIPROCAL_PI2*2.0;
float s=sphereCoords.x*0.5+0.5;
float t=sphereCoords.y;
return vec3(1.0-s,t,0);
}
vec3 computeEquirectangularCoords(vec4 worldPos,vec3 worldNormal,vec3 eyePosition,mat4 reflectionMatrix)
{vec3 cameraToVertex=normalize(worldPos.xyz-eyePosition);
vec3 r=normalize(reflect(cameraToVertex,worldNormal));
r=vec3(reflectionMatrix*vec4(r,0));
float lon=atan(r.z,r.x);
float lat=acos(r.y);
vec2 sphereCoords=vec2(lon,lat)*RECIPROCAL_PI2*2.0;
float s=sphereCoords.x*0.5+0.5;
float t=sphereCoords.y;
return vec3(s,t,0);
}
vec3 computeSphericalCoords(vec4 worldPos,vec3 worldNormal,mat4 view,mat4 reflectionMatrix)
{vec3 viewDir=normalize(vec3(view*worldPos));
vec3 viewNormal=normalize(vec3(view*vec4(worldNormal,0.0)));
vec3 r=reflect(viewDir,viewNormal);
r=vec3(reflectionMatrix*vec4(r,0));
r.z=r.z-1.0;
float m=2.0*length(r);
return vec3(r.x/m+0.5,1.0-r.y/m-0.5,0);
}
vec3 computePlanarCoords(vec4 worldPos,vec3 worldNormal,vec3 eyePosition,mat4 reflectionMatrix)
{vec3 viewDir=worldPos.xyz-eyePosition;
vec3 coords=normalize(reflect(viewDir,worldNormal));
return vec3(reflectionMatrix*vec4(coords,1));
}
vec3 computeCubicCoords(vec4 worldPos,vec3 worldNormal,vec3 eyePosition,mat4 reflectionMatrix)
{vec3 viewDir=normalize(worldPos.xyz-eyePosition);
vec3 coords=reflect(viewDir,worldNormal);
coords=vec3(reflectionMatrix*vec4(coords,0));
coords.y*=-1.0;
return coords;
}
vec3 computeCubicLocalCoords(vec4 worldPos,vec3 worldNormal,vec3 eyePosition,mat4 reflectionMatrix,vec3 reflectionSize,vec3 reflectionPosition)
{vec3 viewDir=normalize(worldPos.xyz-eyePosition);
vec3 coords=reflect(viewDir,worldNormal);
coords=parallaxCorrectNormal(worldPos.xyz,coords,reflectionSize,reflectionPosition);
coords=vec3(reflectionMatrix*vec4(coords,0));
coords.y*=-1.0;
return coords;
}
vec3 computeProjectionCoords(vec4 worldPos,mat4 view,mat4 reflectionMatrix)
{return vec3(reflectionMatrix*(view*worldPos));
}
vec3 computeSkyBoxCoords(vec3 positionW,mat4 reflectionMatrix)
{return vec3(reflectionMatrix*vec4(positionW,1.));
}
vec3 computeReflectionCoords(vec4 worldPos,vec3 worldNormal)
{
return computeCubicCoords(worldPos,worldNormal,vEyePosition.xyz,reflectionMatrix);
}
// Atmosphere fog, spliced into the PBR fragment by AtmospherePlugin in
// atmosphere.ts at CUSTOM_FRAGMENT_DEFINITIONS and called from the regex
// replacement of Babylon's fog mix line. Plugin custom code is applied after
// include expansion and before conditional evaluation, so nothing here may
// rely on material conditionals: the gate is the atmOn uniform.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The literals below mirror atmosphereParams.ts and a lockstep test asserts
// they agree. Tune them there and here together.
// The cloud map sampler is declared here, not in AtmospherePlugin's
// getUniforms().fragment, because that string lands at
// ADDITIONAL_FRAGMENT_DECLARATION, which exists only on the non-uniform-buffer
// path. With UBOs supported, the fragment declaration include resolves to
// pbrUboDeclaration instead, which carries only ADDITIONAL_UBO_DECLARATION,
// and a sampler cannot live in a UBO — so the uniform would silently vanish
// and every PBR fragment shader would fail to compile. This file lands at
// CUSTOM_FRAGMENT_DEFINITIONS on both paths, the terrainTexture.ts precedent
// for the same trap. getSamplers still lists atmCloudMap, unchanged.
//
// It is the plugin's one sampler: a material has sixteen units and one is
// at them, so the distance gradient is not a texture but the curve below on
// the far colour (atmosphereParams.ts, fogGradientUnder), and the ground
// cloud's map (cloudParams.ts) is one texture: tileable noise in R and G,
// read wrapping, and the height of the ground round the player in B, read
// with its coordinates held off the edge so the wrap never reaches it.
layout(set = 1, binding = 11) uniform sampler atmCloudMapSampler;
                        layout(set = 1, binding = 10) uniform texture2D atmCloudMapTexture;
                        #define atmCloudMap sampler2D(atmCloudMapTexture, atmCloudMapSampler)
// The distance gradient: the far colour dimmed to ATM_NEAR_DIM at the eye,
// rising as t to the power 1 / ATM_GRADIENT_BIAS. Mirrors fogGradientUnder.
const float ATM_NEAR_DIM = 0.85;
const float ATM_GRADIENT_BIAS = 1.6;
// Half a texel of the map: the ground read stays this far inside it.
const float ATM_CLOUD_EDGE = 0.5 / 64.0;
// The most steps the cloud's march takes. atmCloudSteps, a uniform, stops it
// earlier, by tier, and at 0 there is no cloud.
const int ATM_CLOUD_STEPS_MAX = 12;
// Slope below which a ray counts as level, to keep the closed form finite.
const float ATM_LEVEL_SLOPE = 1.0e-3;
// Quilez closed-form height fog: density a*exp(-b*y) integrated along a ray
// of length t from height y0 with vertical slope rdY. Mirrors heightFogAmount
// in atmosphereParams.ts exactly.
float atmHeightFog(float y0, float rdY, float t, float a, float b) {
float slope = abs(rdY) < ATM_LEVEL_SLOPE ? (rdY < 0.0 ? -ATM_LEVEL_SLOPE : ATM_LEVEL_SLOPE) : rdY;
return (a / b) * exp(-y0 * b) * (1.0 - exp(-t * slope * b)) / slope;
}
// The ground under a place, read from the map round the player: the rect
// holds its centre, 1 / its span and its base height, and the range is the
// metres its 0 to 1 spans; x is the ground's height, y how far off the trail
// the place is (0 on it, 1 beside it). Beyond the map the edge texel repeats.
vec2 atmCloudGround(vec2 xz) {
vec2 uv = clamp((xz - atmCloudGroundRect.xy) * atmCloudGroundRect.z + 0.5, ATM_CLOUD_EDGE, 1.0 - ATM_CLOUD_EDGE);
vec4 g = textureLod(atmCloudMap, uv, 0.0);
return vec2(atmCloudGroundRect.w + g.b * atmCloudGroundRange, g.a);
}
// The cloud's extinction at a point s metres out along the ray: the density,
// falling off with height above the ground (seated a little below it),
// shaped by a large and a small read of the noise, each drifting on the
// wind. Within atmCloudNear of the eye the shapes smooth out to a plain veil,
// the small ones first: a feature a metre or two off sweeps across the view
// at a walker's parallax, tens of degrees a second, and read as the mist
// rushing past, where the mist should hang. Explicit-level reads, so the
// march is free of the uniformity rules a derivative read would be under.
float atmCloudAt(vec3 p, float s) {
vec2 ground = atmCloudGround(p.xz);
float above = p.y - ground.x + atmCloudSeat;
  // Thin on the trail (atmCloudTrail of itself), whole beside it: the way is open, the sides are not.
float h = exp(-max(above, 0.0) * atmCloudFalloff) * mix(atmCloudTrail, 1.0, ground.y);
float large = textureLod(atmCloudMap, p.xz * atmCloudNoiseScale.x + atmCloudWind, 0.0).r;
float small = textureLod(atmCloudMap, (p.xz + vec2(p.y, -p.y) * 0.7) * atmCloudNoiseScale.y - atmCloudWind.yx, 0.0).g;
large = mix(0.7, large, smoothstep(0.0, atmCloudNear * 0.5, s));
small = mix(0.7, small, smoothstep(atmCloudNear * 0.2, atmCloudNear, s));
float n = clamp(large * small * 2.4 - 0.2, 0.0, 1.0);
return atmCloudDensity * h * n;
}
// The cloud's optical depth from the eye along rd to t: at most
// ATM_CLOUD_STEPS_MAX steps, packed toward the eye (where the wisps are
// walked through), none past atmCloudRange.
float atmCloudDepth(vec3 ro, vec3 rd, float t) {
float reach = min(t, atmCloudRange);
float od = 0.0;
float prev = 0.0;
for (int i = 1;
i <= ATM_CLOUD_STEPS_MAX;
i++) {
if (float(i) > atmCloudSteps) break;
float f = float(i) / atmCloudSteps;
float s = reach * f * f;
float mid = 0.5 * (prev + s);
od += atmCloudAt(ro + rd * mid, mid) * (s - prev);
prev = s;
}
return od;
}
// lit is the lit surface colour, fog is Babylon's linearised EXP2 factor
// (1 = clear, 0 = fully fogged). Returns the fogged colour. atmOn below 0.5
// reproduces Babylon's own mix so an unbound record is harmless.
vec3 atmosphereFog(vec3 lit, float fog) {
if (atmOn < 0.5) {
return mix(vFogColor, lit, fog);
}
vec3 toFrag = vPositionW - vEyePosition.xyz;
float d = length(toFrag);
vec3 rd = toFrag / max(d, 1.0e-4);
float y0 = vEyePosition.y - atmReferenceLevel;
float height = atmHeightFog(y0, rd.y, d, atmHeightDensity, atmHeightFalloff);
float transmit = fog * exp(-max(height, 0.0));
vec3 gradient = atmFarColour * mix(ATM_NEAR_DIM, 1.0, pow(clamp(d * atmGradientScale, 0.0, 1.0), 1.0 / ATM_GRADIENT_BIAS));
float glow = pow(max(dot(rd, atmSunDir), 0.0), atmSunPower) * atmSunWeight;
vec3 air = mix(gradient, atmSunColour, glow);
vec3 fogged = mix(air, lit, clamp(transmit, 0.0, 1.0));
if (atmCloudSteps < 0.5) {
return fogged;
}
  // The ground cloud, in front of the air: its own colour, glowing a little
  // toward the sun or moon, over the fogged surface by its optical depth.
float od = atmCloudDepth(vEyePosition.xyz, rd, d);
float cloudGlow = pow(max(dot(rd, atmSunDir), 0.0), atmCloudGlow.y) * atmCloudGlow.x;
vec3 cloud = atmCloudColour + atmSunColour * cloudGlow;
return mix(cloud, fogged, exp(-od));
}
// Wet plugin, fragment definitions: what the water touches is darker and
// glossy below the wet line, and on the medium and low tiers darkened by
// the water above it as well (spec §6). Applied on both UBO paths at
// CUSTOM_FRAGMENT_DEFINITIONS.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The literals mirror wetPlugin.ts and a lockstep test asserts they agree.
const float WET_ALBEDO = 0.4;
const float WET_ROUGHNESS = 0.15;
const float WET_BAND = 0.1;
// 1 below the line, 0 above it, blended over WET_BAND.
float wetBelow(float y, float line) {
return 1.0 - smoothstep(line - WET_BAND * 0.5, line + WET_BAND * 0.5, y);
}
// 1 inside the body's footprint, 0 from 3 m past its rim, blended from 1 m.
// Both the wet look and the darkening by the water above are held to it.
float wetInside(vec2 xz, vec2 centre, float radius) {
return 1.0 - smoothstep(radius + 1.0, radius + 3.0, length(xz - centre));
}
// The cove's swash (wetPlugin.ts, swashTable.ts): inside the cove the ground
// is wet up to the line each column's sheet last climbed to, and dries after
// it. wetCove is (z0, halfWidth, toeD, faceGrade), wetSwash the table's
// (reach, age) two columns a vec4: the reach in metres up the face from the
// still waterline, the age in seconds since a sheet last covered the column.
// The literals mirror wetPlugin.ts and a lockstep test asserts they agree.
const float WET_DAMP_ALBEDO = 0.7;
const float WET_DAMP_ROUGHNESS = 0.5;
const float WET_DRY_S = 60.0;
const float WET_SOAKED_S = 0.5;
const float WET_SPECKLE = 0.2;
const float WET_SPECKLE_S = 10.0;
const float WET_SPECKLE_CELL = 0.05;
const float WET_SPECKLE_COVER = 0.25;
const float WET_SPECKLE_NEAR = 10.0;
const float WET_SPECKLE_FAR = 25.0;
const float WET_COVE_END = 30.0;
const float WET_SWASH_COLUMNS = 512.0;
const float WET_SWASH_HALF = 256.0;
// The cove's share at world z: 1 across it, 0 past WET_COVE_END beyond
// either end, blended over the ends as the ground is, so the bays keep the
// still line alone and no seam shows where the pebbles meet the sand.
float wetCoveShare(float z) {
return 1.0 - smoothstep(wetCove.y - WET_COVE_END, wetCove.y + WET_COVE_END, abs(z - wetCove.x));
}
// The table's column nearest world z, as the sea reads its own (oceanSwash.fx):
// its reach and its age, from the pair of columns its vec4 holds, the half
// picked by the column's parity.
vec2 wetSwashAt(float z) {
float c = floor(clamp(z - wetCove.x + WET_SWASH_HALF, 0.0, WET_SWASH_COLUMNS - 1.0) + 0.5);
vec4 pair = wetSwash[int(c * 0.5)];
return mix(pair.xy, pair.zw, mod(c, 2.0));
}
// The cove's wetting at a point: how soaked, how damp, and the speckle's
// weight. Below the face's height at the column's reach (wetLevel plus the
// reach times the grade), soaked for WET_SOAKED_S after a sheet, damp by a
// third of WET_DRY_S, dry by WET_DRY_S, and above the still sea a speckle of
// foam fading over WET_SPECKLE_S. All 0 outside the cove.
vec3 wetShore(vec2 xz, float y) {
vec2 col = wetSwashAt(xz.y);
float band = wetBelow(y, wetLevel + col.x * wetCove.w) * wetCoveShare(xz.y);
float soaked = 1.0 - smoothstep(WET_SOAKED_S, WET_DRY_S / 3.0, col.y);
float damp = smoothstep(WET_SOAKED_S, WET_DRY_S / 3.0, col.y) - smoothstep(WET_DRY_S / 3.0, WET_DRY_S, col.y);
float fresh = clamp(1.0 - col.y / WET_SPECKLE_S, 0.0, 1.0);
float above = 1.0 - wetBelow(y, wetLevel);
return vec3(soaked, damp, WET_SPECKLE * fresh * above) * band;
}
// The speckle's foam: WET_SPECKLE_COVER of the WET_SPECKLE_CELL cells carry
// it, faded to that share as the point's distance from the eye (far) runs
// from WET_SPECKLE_NEAR to WET_SPECKLE_FAR metres, where the cells fall under
// a pixel. The hash is the water's skin's, without sine, which loses
// precision at world coordinates.
float wetSpeckle(vec2 xz, float far) {
vec3 p3 = fract(vec3(floor(xz / WET_SPECKLE_CELL).xyx) * 0.1031);
p3 += dot(p3, p3.yzx + 33.33);
float on = step(1.0 - WET_SPECKLE_COVER, fract((p3.x + p3.y) * p3.z));
return mix(on, WET_SPECKLE_COVER, smoothstep(WET_SPECKLE_NEAR, WET_SPECKLE_FAR, far));
}
#define CUSTOM_FRAGMENT_DEFINITIONS
struct albedoOpacityOutParams
{vec3 surfaceAlbedo;
float alpha;
};
#define pbr_inline
albedoOpacityOutParams albedoOpacityBlock(
in vec4 vAlbedoColor
,in float baseWeight
)
{albedoOpacityOutParams outParams;
vec3 surfaceAlbedo=vAlbedoColor.rgb;
float alpha=vAlbedoColor.a;
#define CUSTOM_FRAGMENT_UPDATE_ALBEDO
surfaceAlbedo*=baseWeight;
outParams.surfaceAlbedo=surfaceAlbedo;
outParams.alpha=alpha;
return outParams;
}
struct reflectivityOutParams
{float microSurface;
float roughness;
float diffuseRoughness;
float reflectanceF0;
vec3 reflectanceF90;
vec3 colorReflectanceF0;
vec3 colorReflectanceF90;
vec3 surfaceAlbedo;
float metallic;
float specularWeight;
vec3 dielectricColorF0;
};
#define pbr_inline
reflectivityOutParams reflectivityBlock(
in vec4 reflectivityColor
,in vec3 surfaceAlbedo
,in vec4 metallicReflectanceFactors
,in float baseDiffuseRoughness
)
{reflectivityOutParams outParams;
float microSurface=reflectivityColor.a;
vec3 surfaceReflectivityColor=reflectivityColor.rgb;
vec2 metallicRoughness=surfaceReflectivityColor.rg;
float ior=surfaceReflectivityColor.b;
// Wet plugin, the weather's wetting: Lagarde's porosity rule, applied at
// CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS, inside the metallic workflow's
// reflectivity block, where metallicRoughness.g is the material's final
// roughness (its map, detail and microsurface map applied) and
// surfaceAlbedo is the base colour the block copies out next. A porous
// surface (rough, above 0.5) darkens to a fifth and glosses by half of
// that at full wetness, a polished one does not change, and each material
// caps its porosity: bark soaks, a leaf glazes. wetWeather is the weather's
// wetness, bound once a frame for every material.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
{
float wetPorosity = min(wetCap, clamp((metallicRoughness.g - 0.5) / 0.4, 0.0, 1.0));
float wetFactor = mix(1.0, 0.2, wetPorosity);
surfaceAlbedo *= mix(1.0, wetFactor, wetWeather);
float wetGloss = mix(1.0, 1.0 - metallicRoughness.g, mix(1.0, wetFactor, 0.5 * wetWeather));
metallicRoughness.g = 1.0 - wetGloss;
}
#define CUSTOM_FRAGMENT_UPDATE_METALLICROUGHNESS
microSurface=1.0-metallicRoughness.g;
vec3 baseColor=surfaceAlbedo;
outParams.metallic=metallicRoughness.r;
outParams.specularWeight=metallicReflectanceFactors.a;
float dielectricF0=reflectivityColor.a*outParams.specularWeight;
surfaceReflectivityColor=metallicReflectanceFactors.rgb;
outParams.surfaceAlbedo=baseColor.rgb*(vec3(1.0)-vec3(dielectricF0)*surfaceReflectivityColor)*(1.0-outParams.metallic);
{vec3 reflectivityColor=mix(dielectricF0*surfaceReflectivityColor,baseColor.rgb,outParams.metallic);
outParams.reflectanceF0=max(reflectivityColor.r,max(reflectivityColor.g,reflectivityColor.b));
}
outParams.reflectanceF90=vec3(outParams.specularWeight);
float f90Scale=1.0;
outParams.dielectricColorF0=vec3(dielectricF0*surfaceReflectivityColor);
vec3 metallicColorF0=baseColor.rgb;
outParams.colorReflectanceF0=mix(outParams.dielectricColorF0,metallicColorF0,outParams.metallic);
vec3 dielectricColorF90=vec3(outParams.specularWeight*f90Scale);
vec3 conductorColorF90=outParams.reflectanceF90;
outParams.colorReflectanceF90=mix(dielectricColorF90,conductorColorF90,outParams.metallic);
microSurface=saturate(microSurface);
float roughness=1.-microSurface;
float diffuseRoughness=baseDiffuseRoughness;
outParams.microSurface=microSurface;
outParams.roughness=roughness;
outParams.diffuseRoughness=diffuseRoughness;
return outParams;
}
struct ambientOcclusionOutParams
{vec3 ambientOcclusionColor;
};
ambientOcclusionOutParams ambientOcclusionBlock(
)
{ambientOcclusionOutParams outParams;
vec3 ambientOcclusionColor=vec3(1.,1.,1.);
outParams.ambientOcclusionColor=ambientOcclusionColor;
return outParams;
}
struct reflectionOutParams
{vec4 environmentRadiance;
vec3 environmentIrradiance;
vec3 reflectionCoords;
};
#define pbr_inline
void createReflectionCoords(
in vec3 vPositionW,
in vec3 normalW,
out vec3 reflectionCoords
)
{
vec3 reflectionVector=computeReflectionCoords(vec4(vPositionW,1.0),normalW);
reflectionCoords=reflectionVector;
}
#define pbr_inline

#define pbr_inline

struct clearcoatOutParams
{vec3 specularEnvironmentR0;
float conservationFactor;
vec3 clearCoatNormalW;
vec2 clearCoatAARoughnessFactors;
float clearCoatIntensity;
float clearCoatRoughness;
vec3 finalClearCoatRadianceScaled;
vec3 energyConservationFactorClearCoat;
};
struct iridescenceOutParams
{float iridescenceIntensity;
float iridescenceIOR;
float iridescenceThickness;
vec3 specularEnvironmentR0;
};
struct subSurfaceOutParams
{vec3 specularEnvironmentReflectance;
};
layout(location = 0) out vec4 glFragColor;
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
vec3 viewDirectionW=normalize(vEyePosition.xyz-vPositionW);
vec3 normalW=normalize(vNormalW);
vec3 geometricNormalW=normalW;
vec2 uvOffset=vec2(0.0,0.0);
albedoOpacityOutParams albedoOpacityOut;
albedoOpacityOut=albedoOpacityBlock(
vAlbedoColor
,baseWeight
);
vec3 surfaceAlbedo=albedoOpacityOut.surfaceAlbedo;
float alpha=albedoOpacityOut.alpha;
#define CUSTOM_FRAGMENT_UPDATE_ALPHA
float wetIn = wetInside(vPositionW.xz, wetCentre, wetRadius);
float wetStill = wetBelow(vPositionW.y, wetLine) * wetIn;
// Inside the cove the swash's table wets the face as well (wetShore): soaked
// up to the still line or the column's reach, whichever is higher, then damp
// where the still line leaves the ground dry, and speckled. Outside it the
// three are 0 and the still line's look is as it was, to the bit.
vec3 wetCoveW = wetShore(vPositionW.xz, vPositionW.y) * wetIn;
float wetW = max(wetStill, wetCoveW.x);
float wetDamp = wetCoveW.y * (1.0 - wetStill);
surfaceAlbedo *= mix(1.0, WET_ALBEDO, wetW) * mix(1.0, WET_DAMP_ALBEDO, wetDamp);
surfaceAlbedo = mix(surfaceAlbedo, vec3(1.0), wetCoveW.z * wetSpeckle(vPositionW.xz, length(vPositionW - vEyePosition.xyz)));
float wetKdMean = (wetKd.r + wetKd.g + wetKd.b) / 3.0;
vec3 wetResidual = min(vec3(1.0), exp(-2.0 * (wetKd - vec3(wetKdMean)) * max(0.0, wetLevel - vPositionW.y) * wetIn));
surfaceAlbedo *= mix(vec3(1.0), wetResidual, wetAttenuate);
#define CUSTOM_FRAGMENT_BEFORE_LIGHTS
ambientOcclusionOutParams aoOut;
aoOut=ambientOcclusionBlock(
);
vec3 baseColor=surfaceAlbedo;
reflectivityOutParams reflectivityOut;
vec4 metallicReflectanceFactors=vMetallicReflectanceFactors;
reflectivityOut=reflectivityBlock(
vReflectivityColor
,surfaceAlbedo
,metallicReflectanceFactors
,baseDiffuseRoughness
);
float microSurface=reflectivityOut.microSurface;
float roughness=mix(mix(reflectivityOut.roughness, min(reflectivityOut.roughness, WET_DAMP_ROUGHNESS), wetDamp), WET_ROUGHNESS, wetW);
float diffuseRoughness=reflectivityOut.diffuseRoughness;
surfaceAlbedo=reflectivityOut.surfaceAlbedo;
float NdotVUnclamped=dot(normalW,viewDirectionW);
float NdotV=absEps(NdotVUnclamped);
float alphaG=convertRoughnessToAverageSlope(roughness);
vec2 AARoughnessFactors=getAARoughnessFactors(normalW.xyz);
alphaG+=AARoughnessFactors.y;
vec3 environmentBrdf=getBRDFLookup(NdotV,roughness);
float ambientMonochrome=getLuminance(aoOut.ambientOcclusionColor);
float seo=environmentRadianceOcclusion(ambientMonochrome,NdotVUnclamped);
reflectionOutParams reflectionOut;
reflectionOutParams reflectionBlock_0;
{reflectionOutParams outParams;
vec4 environmentRadiance=vec4(0.,0.,0.,0.);
vec3 reflectionCoords=vec3(0.);
createReflectionCoords(
vPositionW,
normalW,
reflectionCoords
);
{
float reflectionLOD=getLodFromAlphaG(vReflectionMicrosurfaceInfos.x,alphaG);
reflectionLOD=reflectionLOD*vReflectionMicrosurfaceInfos.y+vReflectionMicrosurfaceInfos.z;
float requestedReflectionLOD=reflectionLOD;
environmentRadiance=sampleReflectionLod(reflectionSampler,reflectionCoords,reflectionLOD);
environmentRadiance.rgb=toLinearSpace(environmentRadiance.rgb);
environmentRadiance.rgb*=vReflectionInfos.x;
environmentRadiance.rgb*=vReflectionColor.rgb;
};
vec3 environmentIrradiance=vec3(0.,0.,0.);
environmentIrradiance=vEnvironmentIrradiance;
environmentIrradiance*=vReflectionColor.rgb*vReflectionInfos.x;
outParams.environmentRadiance=vec4(mix(environmentRadiance.rgb,environmentIrradiance,alphaG),environmentRadiance.a);
outParams.environmentIrradiance=environmentIrradiance;
outParams.reflectionCoords=reflectionCoords;
reflectionBlock_0 = outParams;
}
reflectionOut=reflectionBlock_0;
float reflectanceF0=reflectivityOut.reflectanceF0;
vec3 specularEnvironmentR0=reflectivityOut.colorReflectanceF0;
vec3 specularEnvironmentR90=reflectivityOut.colorReflectanceF90;
clearcoatOutParams clearcoatOut;
clearcoatOut.specularEnvironmentR0=specularEnvironmentR0;
vec3 baseSpecularEnvironmentReflectance=getReflectanceFromBRDFLookup(vec3(reflectanceF0),reflectivityOut.reflectanceF90,environmentBrdf);
vec3 colorSpecularEnvironmentReflectance=getReflectanceFromBRDFLookup(clearcoatOut.specularEnvironmentR0,reflectivityOut.colorReflectanceF90,environmentBrdf);
colorSpecularEnvironmentReflectance*=seo;
subSurfaceOutParams subSurfaceOut;
subSurfaceOut.specularEnvironmentReflectance=colorSpecularEnvironmentReflectance;
vec3 diffuseBase=vec3(0.,0.,0.);
vec3 specularBase=vec3(0.,0.,0.);
vec3 coloredFresnel;
preLightingInfo preInfo;
lightingInfo info;
float shadow=1.;
float aggShadow=0.;
float numLights=0.;
vec4 diffuse0=light0.vLightDiffuse;
#define CUSTOM_LIGHT0_COLOR 
preInfo=computePointAndSpotPreLightingInfo(light0.vLightData,viewDirectionW,normalW,vPositionW);
preInfo.NdotV=NdotV;
preInfo.attenuation=computeDistanceLightFalloff(preInfo.lightOffset,preInfo.lightDistanceSquared,light0.vLightFalloff.x,light0.vLightFalloff.y);
preInfo.attenuation*=computeDirectionalLightFalloff(light0.vLightDirection.xyz,preInfo.L,light0.vLightDirection.w,light0.vLightData.w,light0.vLightFalloff.z,light0.vLightFalloff.w);
preInfo.roughness=adjustRoughnessFromLightProperties(roughness,light0.vLightSpecular.a,preInfo.lightDistance);
preInfo.diffuseRoughness=diffuseRoughness;
preInfo.surfaceAlbedo=surfaceAlbedo;
info.diffuse=computeDiffuseLighting(preInfo,diffuse0.rgb);
coloredFresnel=fresnelSchlickGGX(preInfo.VdotH,clearcoatOut.specularEnvironmentR0,reflectivityOut.colorReflectanceF90);
info.specular=computeSpecularLighting(preInfo,normalW,clearcoatOut.specularEnvironmentR0,coloredFresnel,AARoughnessFactors.x,diffuse0.rgb);
shadow=1.;
aggShadow+=shadow;
numLights+=1.0;
diffuseBase+=info.diffuse*shadow;
specularBase+=info.specular*shadow;
vec4 diffuse1=light1.vLightDiffuse;
#define CUSTOM_LIGHT1_COLOR 
preInfo=computeDirectionalPreLightingInfo(light1.vLightData,viewDirectionW,normalW);
preInfo.NdotV=NdotV;
preInfo.attenuation=1.0;
preInfo.roughness=adjustRoughnessFromLightProperties(roughness,light1.vLightSpecular.a,preInfo.lightDistance);
preInfo.diffuseRoughness=diffuseRoughness;
preInfo.surfaceAlbedo=surfaceAlbedo;
info.diffuse=computeDiffuseLighting(preInfo,diffuse1.rgb);
coloredFresnel=fresnelSchlickGGX(preInfo.VdotH,clearcoatOut.specularEnvironmentR0,reflectivityOut.colorReflectanceF90);
info.specular=computeSpecularLighting(preInfo,normalW,clearcoatOut.specularEnvironmentR0,coloredFresnel,AARoughnessFactors.x,diffuse1.rgb);
shadow=1.;
aggShadow+=shadow;
numLights+=1.0;
diffuseBase+=info.diffuse*shadow;
specularBase+=info.specular*shadow;
vec4 diffuse2=light2.vLightDiffuse;
#define CUSTOM_LIGHT2_COLOR 
preInfo=computeHemisphericPreLightingInfo(light2.vLightData,viewDirectionW,normalW);
preInfo.NdotV=NdotV;
preInfo.attenuation=1.0;
preInfo.roughness=roughness;
preInfo.diffuseRoughness=diffuseRoughness;
preInfo.surfaceAlbedo=surfaceAlbedo;
info.diffuse=computeHemisphericDiffuseLighting(preInfo,diffuse2.rgb,light2.vLightGround);
coloredFresnel=fresnelSchlickGGX(preInfo.VdotH,clearcoatOut.specularEnvironmentR0,reflectivityOut.colorReflectanceF90);
info.specular=computeSpecularLighting(preInfo,normalW,clearcoatOut.specularEnvironmentR0,coloredFresnel,AARoughnessFactors.x,diffuse2.rgb);
shadow=1.;
aggShadow+=shadow;
numLights+=1.0;
diffuseBase+=info.diffuse*shadow;
specularBase+=info.specular*shadow;
aggShadow=aggShadow/numLights;
vec3 baseSpecularEnergyConservationFactor=getEnergyConservationFactor(vec3(reflectanceF0),environmentBrdf);
vec3 coloredEnergyConservationFactor=getEnergyConservationFactor(clearcoatOut.specularEnvironmentR0,environmentBrdf);
vec3 finalIrradiance=reflectionOut.environmentIrradiance;
finalIrradiance*=surfaceAlbedo.rgb;
finalIrradiance*=vLightingIntensity.z;
finalIrradiance*=aoOut.ambientOcclusionColor;
vec3 finalSpecular=specularBase;
finalSpecular=max(finalSpecular,0.0);
vec3 finalSpecularScaled=finalSpecular*vLightingIntensity.x*vLightingIntensity.w;
finalSpecularScaled*=coloredEnergyConservationFactor;
vec3 finalRadiance=reflectionOut.environmentRadiance.rgb;
finalRadiance*=colorSpecularEnvironmentReflectance;
vec3 finalRadianceScaled=finalRadiance*vLightingIntensity.z;
finalRadianceScaled*=coloredEnergyConservationFactor;
vec3 finalDiffuse=diffuseBase;
finalDiffuse*=surfaceAlbedo;
finalDiffuse=max(finalDiffuse,0.0);
finalDiffuse*=vLightingIntensity.x;
vec3 finalAmbient=vAmbientColor;
finalAmbient*=surfaceAlbedo.rgb;
vec3 finalEmissive=vEmissiveColor;
finalEmissive*=vLightingIntensity.y;
vec3 ambientOcclusionForDirectDiffuse=aoOut.ambientOcclusionColor;
finalAmbient*=aoOut.ambientOcclusionColor;
finalDiffuse*=ambientOcclusionForDirectDiffuse;
#define CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION
vec4 finalColor=vec4(
finalIrradiance +
finalSpecularScaled +
finalRadianceScaled +
finalAmbient +
finalDiffuse,
alpha);
finalColor.rgb+=finalEmissive;
#define CUSTOM_FRAGMENT_BEFORE_FOG
finalColor=max(finalColor,0.0);
float fog=CalcFogFactor();
fog=toLinearSpace(fog);
finalColor.rgb=atmosphereFog(finalColor.rgb,fog);
finalColor.rgb=clamp(finalColor.rgb,0.,30.0);
finalColor.a*=visibility;
#define CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR
glFragColor=finalColor;
#define CUSTOM_FRAGMENT_MAIN_END
}
