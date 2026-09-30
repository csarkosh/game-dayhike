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
#define TERRAINTEX
#define ROADPAINT
#define TRAILPAINT
#define FEATUREPAINT
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
#define VERTEXCOLOR
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
#define NUM_BONE_INFLUENCERS 0
#define BonesPerMesh 0
#define NUM_MORPH_INFLUENCERS 0
#define ORDER_INDEPENDENT_TRANSPARENCY_16BITS
#define USEPHYSICALLIGHTFALLOFF
#define SHADOWFLOAT
#define FOG
#define CAMERA_PERSPECTIVE
#define AREALIGHTSUPPORTED
#define TEXTURE_REPETITION_MODE 0
#define DEBUGMODE 0
#define VERTEX_PULLING_USE_INDEX_BUFFER
#define CLUSTLIGHT_SLICES 0
#define CLUSTLIGHT_BATCH 0
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
#define MAXLIGHTCOUNT 7

#define SHADER_NAME fragment:pbr
layout(set = 1, binding = 38) uniform LeftOver {
        mat4 lightMatrix1[2];
    float viewFrustumZ1[2];
    float frustumLengths1[2];
    float cascadeBlendFactor1;
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
vec4 terrainTiling;
vec2 terrainRock2;
vec2 terrainFade;
vec3 terrainEye;
vec4 roadTable;
vec4 trailInfo;
float terrainWet;
vec4 featureInfo;
vec4 terrainLayerRough;
vec2 terrainLayerRough2;
vec4 terrainLayerF0;
vec2 terrainLayerF02;
float terrainReliefOn;
vec4 terrainDetail;
vec3 terrainDetail2;
float terrainMacroOn;
vec3 terrainHorizon;
vec3 terrainTuft;
vec4 terrainSward;
vec4 terrainSwardBand;
float wetLine;
float wetLevel;
vec2 wetCentre;
float wetRadius;
vec3 wetKd;
float wetAttenuate;
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
layout(location = 3)  in vec4 vColor;
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




layout(location = 5)  in vec4 vPositionFromLight1[SHADOWCSMNUM_CASCADES1];
layout(location = 7)  in float vDepthMetric1[SHADOWCSMNUM_CASCADES1];
layout(location = 9)  in vec4 vPositionFromCamera1;
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
#define sampleReflection(s,c) texture(s,c)
layout(set = 1, binding = 9) uniform sampler reflectionSamplerSampler;
                        layout(set = 1, binding = 8) uniform textureCube reflectionSamplerTexture;
                        #define reflectionSampler samplerCube(reflectionSamplerTexture, reflectionSamplerSampler)
#define sampleReflectionLod(s,c,l) textureLod(s,c,l)
layout(set = 1, binding = 11) uniform sampler environmentBrdfSamplerSampler;
                        layout(set = 1, binding = 10) uniform texture2D environmentBrdfSamplerTexture;
                        #define environmentBrdfSampler sampler2D(environmentBrdfSamplerTexture, environmentBrdfSamplerSampler)
#define FOGMODE_NONE 0.
#define FOGMODE_EXP 1.
#define FOGMODE_EXP2 2.
#define FOGMODE_LINEAR 3.
#define E 2.71828


layout(location = 4)  in vec3 vFogDistance;
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
return vec2(0.);
}
#define CUSTOM_IMAGEPROCESSINGFUNCTIONS_DEFINITIONS
vec4 applyImageProcessing(vec4 result) {
#define CUSTOM_IMAGEPROCESSINGFUNCTIONS_UPDATERESULT_ATSTART
result.rgb=toGammaSpace(result.rgb);
result.rgb=saturate(result.rgb);
#define CUSTOM_IMAGEPROCESSINGFUNCTIONS_UPDATERESULT_ATEND
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
// The gradient sampler is declared here, not in AtmospherePlugin's
// getUniforms().fragment, because that string lands at
// ADDITIONAL_FRAGMENT_DECLARATION, which exists only on the non-uniform-buffer
// path. With UBOs supported, the fragment declaration include resolves to
// pbrUboDeclaration instead, which carries only ADDITIONAL_UBO_DECLARATION,
// and a sampler cannot live in a UBO — so the uniform would silently vanish
// and every PBR fragment shader would fail to compile. This file lands at
// CUSTOM_FRAGMENT_DEFINITIONS on both paths, the terrainTexture.ts precedent
// for the same trap. getSamplers still lists atmGradient, unchanged.
layout(set = 1, binding = 13) uniform sampler atmGradientSampler;
                        layout(set = 1, binding = 12) uniform texture2D atmGradientTexture;
                        #define atmGradient sampler2D(atmGradientTexture, atmGradientSampler)
// Slope below which a ray counts as level, to keep the closed form finite.
const float ATM_LEVEL_SLOPE = 1.0e-3;
// Quilez closed-form height fog: density a*exp(-b*y) integrated along a ray
// of length t from height y0 with vertical slope rdY. Mirrors heightFogAmount
// in atmosphereParams.ts exactly.
float atmHeightFog(float y0, float rdY, float t, float a, float b) {
float slope = abs(rdY) < ATM_LEVEL_SLOPE ? (rdY < 0.0 ? -ATM_LEVEL_SLOPE : ATM_LEVEL_SLOPE) : rdY;
return (a / b) * exp(-y0 * b) * (1.0 - exp(-t * slope * b)) / slope;
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
vec3 gradient = texture(atmGradient, vec2(clamp(d * atmGradientScale, 0.0, 1.0), 0.5)).rgb;
float glow = pow(max(dot(rd, atmSunDir), 0.0), atmSunPower) * atmSunWeight;
vec3 air = mix(gradient, atmSunColour, glow);
return mix(air, lit, clamp(transmit, 0.0, 1.0));
}
#define DISABLE_UNIFORMITY_ANALYSIS
layout(location = 10)  in vec4 vTerrainW;
layout(location = 11)  in vec4 vTerrainW2;
layout(location = 12)  in float vTerrainCover;
layout(set = 1, binding = 15) uniform sampler terrainGrassSampler;
                        layout(set = 1, binding = 14) uniform texture2D terrainGrassTexture;
                        #define terrainGrass sampler2D(terrainGrassTexture, terrainGrassSampler)
layout(set = 1, binding = 17) uniform sampler terrainFloorSampler;
                        layout(set = 1, binding = 16) uniform texture2D terrainFloorTexture;
                        #define terrainFloor sampler2D(terrainFloorTexture, terrainFloorSampler)
layout(set = 1, binding = 19) uniform sampler terrainRockSampler;
                        layout(set = 1, binding = 18) uniform texture2D terrainRockTexture;
                        #define terrainRock sampler2D(terrainRockTexture, terrainRockSampler)
layout(set = 1, binding = 21) uniform sampler terrainSandSampler;
                        layout(set = 1, binding = 20) uniform texture2D terrainSandTexture;
                        #define terrainSand sampler2D(terrainSandTexture, terrainSandSampler)
layout(set = 1, binding = 23) uniform sampler terrainPebbleSampler;
                        layout(set = 1, binding = 22) uniform texture2D terrainPebbleTexture;
                        #define terrainPebble sampler2D(terrainPebbleTexture, terrainPebbleSampler)
// highp is required, not decorative: GLSL ES 3.00 has no default fragment
// precision for sampler2DArray, so omitting it is a compile error on real
// WebGL2 ("'sampler2DArray' : No precision specified") that NullEngine's
// string-only preprocessor can never see. Babylon's own array-sampler code
// uses highp for the same reason.
layout(set = 1, binding = 25) uniform sampler terrainNormalsSampler;
                        layout(set = 1, binding = 24) uniform texture2DArray terrainNormalsTexture;
                        #define terrainNormals sampler2DArray(terrainNormalsTexture, terrainNormalsSampler)
layout(set = 1, binding = 27) uniform sampler terrainRAHSampler;
                        layout(set = 1, binding = 26) uniform texture2DArray terrainRAHTexture;
                        #define terrainRAH sampler2DArray(terrainRAHTexture, terrainRAHSampler)
// The grass floor's GLSL: hex tiling (a triangular lattice over the texture
// repeat, three samples at hashed offsets and rotations, sharpened weights),
// the lattice hash and the two-octave macro noise the lush/dry tint rides on,
// and the horizon tint's weight. Spliced by TerrainTexturePlugin at
// CUSTOM_FRAGMENT_DEFINITIONS after its own uniform declarations, so the
// functions below may read terrainHorizon. Every constant mirrors
// groundHexParams.ts and a lockstep test asserts they agree.
//
// The hex offsets use a sin hash that only the GPU evaluates. The macro noise
// uses the multiply-add-fract lattice hash the CPU mirrors exactly, because the
// tufts sample the same tint on the CPU and must agree with the floor.
//
// Samples take explicit gradients of the UNROTATED uv, so a hex seam changes
// the texel fetched but not the mip level, and no seam shows as a blur line.
//
// hexSample2D and hexSampleArray have no caller in the plugin: it sets the
// lattice up once per scale with hexSetup and fetches through hexFetch2D and
// hexFetchArray. They are kept as the one-shot spelling the lockstep tests
// name, and as the obvious entry point for a lone sample.
//
// COMMENT RULES: no semicolon inside a trailing comment on a code line, no
// hashed preprocessor keyword in comment prose.
const float HEX_LATTICE = 1.0;
const float HEX_SHARPNESS = 8.0;
const mat2 HEX_SKEW = mat2(1.0, 0.0, -0.57735027, 1.15470054);
const mat2 HEX_UNSKEW = mat2(1.0, 0.0, 0.5, 0.8660254);
const vec2 MACRO_WAVE = vec2(18.0, 6.0);
const vec2 MACRO_WEIGHT = vec2(0.65, 0.35);
const float MACRO_SLOPE = 0.6;
const vec3 MACRO_LUSH = vec3(0.82, 1.06, 0.84);
const vec3 MACRO_DRY = vec3(1.18, 0.98, 0.7);
const float HEX_TAU = 6.28318531;
// GPU-only: offsets and rotations per lattice vertex. Not mirrored.
float hexHash(vec2 v, float salt) {
return fract(sin(dot(v + salt, vec2(127.1, 311.7))) * 43758.5453);
}
// The lattice triangle the uv falls in: three integer vertices in skewed
// space and their barycentric weights. Mirrors hexTriangle in groundHexParams.ts.
void hexTriangle(vec2 uv, out vec2 v1, out vec2 v2, out vec2 v3, out vec3 w) {
vec2 s = HEX_SKEW * (uv * HEX_LATTICE);
vec2 b = floor(s);
vec2 f = s - b;
if (f.x + f.y < 1.0) {
v1 = b;
v2 = b + vec2(1.0, 0.0);
v3 = b + vec2(0.0, 1.0);
w = vec3(1.0 - f.x - f.y, f.x, f.y);
} else {
v1 = b + vec2(1.0, 1.0);
v2 = b + vec2(1.0, 0.0);
v3 = b + vec2(0.0, 1.0);
w = vec3(f.x + f.y - 1.0, 1.0 - f.y, 1.0 - f.x);
}
}
// The uv to fetch for vertex v: rotate about the vertex, then offset, both hashed.
vec2 hexUv(vec2 uv, vec2 v) {
vec2 vp = (HEX_UNSKEW * v) / HEX_LATTICE;
float a = hexHash(v, 0.0) * HEX_TAU;
float ca = cos(a);
float sa = sin(a);
vec2 d = uv - vp;
vec2 o = vec2(hexHash(v, 7.3), hexHash(v, 13.1));
return vec2(ca * d.x - sa * d.y, sa * d.x + ca * d.y) + o;
}
vec3 hexWeightsSharp(vec3 w) {
vec3 s = pow(max(w, vec3(0.0)), vec3(HEX_SHARPNESS));
return s / max(s.x + s.y + s.z, 1.0e-9);
}
// Everything a hex fetch needs that depends on the uv alone: the three hashed
// uvs and the sharpened weights. Nine sin hashes and a lattice walk, so a
// caller sampling several maps at ONE scale calls this once and hands the
// result to as many fetchers as it likes.
void hexSetup(vec2 uv, out vec2 u1, out vec2 u2, out vec2 u3, out vec3 s) {
vec2 v1;
vec2 v2;
vec2 v3;
vec3 w;
hexTriangle(uv, v1, v2, v3, w);
u1 = hexUv(uv, v1);
u2 = hexUv(uv, v2);
u3 = hexUv(uv, v3);
s = hexWeightsSharp(w);
}
#define hexFetch2D(tex, u1, u2, u3, s, dx, dy) (textureGrad(tex, u1, dx, dy).rgb * (s).x + textureGrad(tex, u2, dx, dy).rgb * (s).y + textureGrad(tex, u3, dx, dy).rgb * (s).z)
#define hexFetchArray(tex, u1, u2, u3, s, layer, dx, dy) (textureGrad(tex, vec3(u1, layer), dx, dy).rgb * (s).x + textureGrad(tex, vec3(u2, layer), dx, dy).rgb * (s).y + textureGrad(tex, vec3(u3, layer), dx, dy).rgb * (s).z)
// Mirrored exactly by latticeHash in groundHexParams.ts.
float latticeHash(vec2 c) {
return fract(0.618034 * c.x + 0.381966 * c.y + 0.0113 * c.x * c.y);
}
float macroValueNoise(vec2 p, float wave) {
vec2 q = p / wave;
vec2 c = floor(q);
vec2 f = smoothstep(0.0, 1.0, q - c);
float a = latticeHash(c);
float b = latticeHash(c + vec2(1.0, 0.0));
float d = latticeHash(c + vec2(0.0, 1.0));
float e = latticeHash(c + vec2(1.0, 1.0));
return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}
float macroNoise(vec2 p) {
return MACRO_WEIGHT.x * macroValueNoise(p, MACRO_WAVE.x) + MACRO_WEIGHT.y * macroValueNoise(p, MACRO_WAVE.y);
}
// slope is 1 minus the ground normal's y. Mirrors macroTint in groundHexParams.ts.
vec3 macroTint(float noise, float slope) {
float m = clamp(noise + MACRO_SLOPE * clamp(slope, 0.0, 1.0), 0.0, 1.0);
return mix(MACRO_LUSH, MACRO_DRY, m);
}
// terrainHorizon = (start, end, max). Mirrors horizonWeight.
float horizonWeight(float dist) {
return terrainHorizon.z * smoothstep(terrainHorizon.x, terrainHorizon.y, dist);
}
layout(set = 1, binding = 29) uniform sampler roadCenterSampler;
                        layout(set = 1, binding = 28) uniform texture2D roadCenterTexture;
                        #define roadCenter sampler2D(roadCenterTexture, roadCenterSampler)
layout(set = 1, binding = 31) uniform sampler roadAsphaltSampler;
                        layout(set = 1, binding = 30) uniform texture2D roadAsphaltTexture;
                        #define roadAsphalt sampler2D(roadAsphaltTexture, roadAsphaltSampler)
layout(set = 1, binding = 33) uniform sampler trailIndexSampler;
                        layout(set = 1, binding = 32) uniform texture2D trailIndexTexture;
                        #define trailIndex sampler2D(trailIndexTexture, trailIndexSampler)
layout(set = 1, binding = 35) uniform sampler trailSegsSampler;
                        layout(set = 1, binding = 34) uniform texture2D trailSegsTexture;
                        #define trailSegs sampler2D(trailSegsTexture, trailSegsSampler)
float trailValueNoise1(float u, float wave) {
float q = u / wave;
float c = floor(q);
float f = smoothstep(0.0, 1.0, q - c);
return mix(latticeHash(vec2(c, 0.0)), latticeHash(vec2(c + 1.0, 0.0)), f);
}
layout(set = 1, binding = 37) uniform sampler featureTexSampler;
                        layout(set = 1, binding = 36) uniform texture2D featureTexTexture;
                        #define featureTex sampler2D(featureTexTexture, featureTexSampler)
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
surfaceAlbedo*=vColor.rgb;
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
float terrainRough = 1.0;
float terrainF0 = 1.0;
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
{
vec2 uvXZ = vPositionW.xz;
vec2 uvG = uvXZ * terrainTiling.x;
vec2 uvF = uvXZ * terrainTiling.y;
vec2 uvS = uvXZ * terrainTiling.z;
vec2 uvP = uvXZ * terrainTiling.w;
  // Gradients of the UNROTATED uv, and the lattice they index, computed once
  // per scale: a hex seam then changes which texel is fetched but not the mip
  // level, so no seam shows as a blur line. Both pairs are taken here, in
  // uniform control flow, rather than inside the gates that use them —
  // a derivative taken in non-uniform flow is undefined by the spec.
vec2 gdx = dFdx(uvG);
vec2 gdy = (-yFactor_)*dFdy(uvG);
vec2 uvD = uvXZ * terrainDetail.x;
vec2 ddx = dFdx(uvD);
vec2 ddy = (-yFactor_)*dFdy(uvD);
  // The 2 m hex lattice is grass-only work: gated on the raw vertex weight so
  // non-grass ground never pays for a lattice walk and three hashed fetches.
  // At exactly zero vertex weight the grass maps switch from the three-tap
  // hex to one plain fetch, so wherever the height blend below still hands
  // grass a share the pattern changes there too — same mean, different
  // texels, bounded by that share times the map's own variance. The coast is
  // the one ground this happens on today.
vec2 g1 = vec2(0.0);
vec2 g2 = vec2(0.0);
vec2 g3 = vec2(0.0);
vec3 gw = vec3(0.0);
if (vTerrainW.x > 0.0) {
hexSetup(uvG, g1, g2, g3, gw);
}
float rt = terrainRock2.x;
vec3 terrainN = vec3(0.0, 1.0, 0.0);
terrainN = normalize(vNormalW);
vec3 an = abs(terrainN);
vec3 bw = an / max(an.x + an.y + an.z, 1e-4);
float dist = distance(vPositionW.xyz, terrainEye);
float strength = vTerrainW2.y * (1.0 - smoothstep(terrainFade.x, terrainFade.y, dist));
  // Plain weights (today's blend) — grass, floor, rock, sand, pebble.
float w0 = vTerrainW.x;
float w1 = vTerrainW.y;
float w2 = vTerrainW.z;
float w3 = vTerrainW.w;
float w4 = vTerrainW2.x;
vec3 rah0 = vec3(0.5, 1.0, 0.5);
vec3 rah1 = rah0;
vec3 rah2 = rah0;
vec3 rah3 = rah0;
vec3 rah4 = rah0;
vec3 nrm = terrainN;
  // Declared out here so the AO line below still compiles — and stays a true
  // no-op — on fragments where the relief gate never runs.
float detailAo = 1.0;
  // Rock parallax: march the eye ray through the rock height on the dominant
  // triplanar face. The three offsets start at zero and only the dominant
  // face's moves, so the minority faces stay flat.
vec2 rpX = vec2(0.0);
vec2 rpY = vec2(0.0);
vec2 rpZ = vec2(0.0);
if (strength > 0.0 && w2 > 0.05) {
vec3 rDir = normalize(vPositionW.xyz - terrainEye);
float rDepth = 0.03 * rt;
vec2 rAb;
vec2 rUv;
if (bw.y >= bw.x && bw.y >= bw.z) { rAb = rDir.xz;
rUv = vPositionW.xz * rt;
}
else if (bw.x >= bw.z) { rAb = rDir.yz;
rUv = vPositionW.yz * rt;
}
else { rAb = rDir.xy;
rUv = vPositionW.xy * rt;
}
vec2 rStep = rAb * rDepth / 12.0;
float rLayer = 1.0 / 12.0;
vec2 rOff = vec2(0.0);
float rD = 0.0;
float rPrev = -(1.0 - texture(terrainRAH, vec3(rUv, 2.0)).b);
bool rHit = rPrev >= 0.0;
for (int ri = 0;
ri < 12;
ri++) {
if (rHit) break;
vec2 nOff = rOff + rStep;
float nD = rD + rLayer;
float rDiff = nD - (1.0 - texture(terrainRAH, vec3(rUv + nOff, 2.0)).b);
if (rDiff >= 0.0) { float rT = rPrev / (rPrev - rDiff);
rOff = rOff + rStep * rT;
rHit = true;
}
else { rOff = nOff;
rD = nD;
rPrev = rDiff;
}
}
    // Fade the offset with the detail strength so the far edge of the fade
    // has no seam, then hand it to the dominant face.
rOff *= strength;
if (bw.y >= bw.x && bw.y >= bw.z) rpY = rOff;
else if (bw.x >= bw.z) rpX = rOff;
else rpZ = rOff;
}
if (strength > 0.0) {
    // The height blend below can hand grass a nonzero share even where its
    // vertex weight is zero: wherever the other layers split the weight and
    // a grass texel's height tops theirs, b0 comes out positive. So every
    // grass term needs a real value here — the hex is skipped only because a
    // single plain fetch is enough for a share this small.
if (vTerrainW.x > 0.0) {
rah0 = hexFetchArray(terrainRAH, g1, g2, g3, gw, 0.0, gdx, gdy);
} else {
rah0 = textureGrad(terrainRAH, vec3(uvG, 0.0), gdx, gdy).rgb;
}
rah1 = texture(terrainRAH, vec3(uvF, 1.0)).rgb;
rah2 = texture(terrainRAH, vec3(vPositionW.xz * rt + rpY, 2.0)).rgb;
rah3 = texture(terrainRAH, vec3(uvS, 3.0)).rgb;
rah4 = texture(terrainRAH, vec3(uvP, 4.0)).rgb;
    // Height blend: the tallest layer within the depth constant
    // below still shows through.
float m = max(max(w0 + rah0.b, w1 + rah1.b), max(max(w2 + rah2.b, w3 + rah3.b), w4 + rah4.b)) - 0.200;
float b0 = max(w0 + rah0.b - m, 0.0);
float b1 = max(w1 + rah1.b - m, 0.0);
float b2 = max(w2 + rah2.b - m, 0.0);
float b3 = max(w3 + rah3.b - m, 0.0);
float b4 = max(w4 + rah4.b - m, 0.0);
float bs = max(b0 + b1 + b2 + b3 + b4, 1e-4);
    // terrainReliefOn: 0 until the real RAH array has
    // landed, so a flat placeholder height (equal on every layer) can never
    // sharpen the class weights into hard edges the way the raw formula
    // above would (0.5/0.3/0.2 -> 1/0/0). With it 0, b collapses back to w
    // before the strength fade below ever runs.
b0 = mix(w0, b0 / bs, terrainReliefOn);
b1 = mix(w1, b1 / bs, terrainReliefOn);
b2 = mix(w2, b2 / bs, terrainReliefOn);
b3 = mix(w3, b3 / bs, terrainReliefOn);
b4 = mix(w4, b4 / bs, terrainReliefOn);
w0 = mix(w0, b0, strength);
w1 = mix(w1, b1, strength);
w2 = mix(w2, b2, strength);
w3 = mix(w3, b3, strength);
w4 = mix(w4, b4, strength);
    // Normals, UDN-style: the map's xy is added to the world normal in the
    // projection's frame. Planar layers: uv is world XZ, so x -> X, y -> Z.
vec3 t0;
if (vTerrainW.x > 0.0) {
t0 = hexFetchArray(terrainNormals, g1, g2, g3, gw, 0.0, gdx, gdy) * 2.0 - 1.0;
} else {
t0 = textureGrad(terrainNormals, vec3(uvG, 0.0), gdx, gdy).rgb * 2.0 - 1.0;
}
vec3 t1 = texture(terrainNormals, vec3(uvF, 1.0)).rgb * 2.0 - 1.0;
vec3 t3 = texture(terrainNormals, vec3(uvS, 3.0)).rgb * 2.0 - 1.0;
vec3 t4 = texture(terrainNormals, vec3(uvP, 4.0)).rgb * 2.0 - 1.0;
vec3 tx = texture(terrainNormals, vec3(vPositionW.yz * rt + rpX, 2.0)).rgb * 2.0 - 1.0;
vec3 ty = texture(terrainNormals, vec3(vPositionW.xz * rt + rpY, 2.0)).rgb * 2.0 - 1.0;
vec3 tz = texture(terrainNormals, vec3(vPositionW.xy * rt + rpZ, 2.0)).rgb * 2.0 - 1.0;
vec2 planar = t0.xy * w0 + t1.xy * w1 + t3.xy * w3 + t4.xy * w4;
    // The near-eye detail scale: the same grass maps at DETAIL_TILING, hex
    // tiled again so the small repeat does not draw its own grid either. Gated
    // on grass weight AND its own fade, inside the relief gate, so the two
    // extra fetches land on grass within DETAIL_FADE of the eye and nowhere
    // else — and on terrainReliefOn, since a flat placeholder normal/height
    // would only add noise. The finer scale adds a normal and a
    // between-blades occlusion; an albedo term was tried and could not be
    // seen with these maps, so it is not fetched.
float detailStrength = w0 * (1.0 - smoothstep(terrainDetail.y, terrainDetail.z, dist)) * terrainReliefOn;
if (detailStrength > 0.0) {
vec2 d1;
vec2 d2;
vec2 d3;
vec3 dw;
hexSetup(uvD, d1, d2, d3, dw);
vec3 tD = hexFetchArray(terrainNormals, d1, d2, d3, dw, 0.0, ddx, ddy) * 2.0 - 1.0;
planar += tD.xy * terrainDetail.w * detailStrength;
float hD = hexFetchArray(terrainRAH, d1, d2, d3, dw, 0.0, ddx, ddy).b;
detailAo = mix(1.0, smoothstep(terrainDetail2.y, terrainDetail2.z, hD), terrainDetail2.x * detailStrength);
}
    // Rock's X-facing projection samples vPositionW.yz, so the map's x runs
    // along world Y and its y along world Z: x,y order,
    // same rule as the other two faces (ty samples xz -> x,y; tz samples
    // xy -> x,y).
vec3 pert = vec3(planar.x, 0.0, planar.y)
+ w2 * (vec3(0.0, tx.x, tx.y) * bw.x + vec3(ty.x, 0.0, ty.y) * bw.y + vec3(tz.x, tz.y, 0.0) * bw.z);
nrm = normalize(terrainN + pert * strength);
    // Written here, inside the gate, not unconditionally below: when strength
    // is 0 this branch never runs at all, so Babylon's own normalW is left
    // exactly as it was rather than being overwritten with terrainN, which
    // contributes nothing new in that case.
normalW = nrm;
}
  // Same story as the relief fetch above: the height blend can still hand
  // grass a nonzero share here even at zero vertex weight, wherever the
  // other layers split the weight and a grass texel's height tops theirs, so
  // this needs a real value too — one plain fetch is enough for a share
  // this small, without paying for the three-tap hex.
vec3 grassAlbedo;
if (vTerrainW.x > 0.0) { grassAlbedo = hexFetch2D(terrainGrass, g1, g2, g3, gw, gdx, gdy) * vec3(1.6447, 1.8904, 2.7933);
}
else { grassAlbedo = textureGrad(terrainGrass, uvG, gdx, gdy).rgb * vec3(1.6447, 1.8904, 2.7933);
}
vec3 blended =
grassAlbedo * w0
+ texture(terrainFloor,  uvF).rgb * vec3(1.5456, 2.0202, 2.8329) * w1
+ texture(terrainSand,   uvS).rgb * vec3(1.7036, 1.9531, 2.5316) * w3
+ texture(terrainPebble, uvP).rgb * vec3(1.8484, 2.0121, 2.1882) * w4
+ w2 * vec3(1.8519, 1.9763, 2.2272) * (
texture(terrainRock, vPositionW.yz * rt + rpX).rgb * bw.x
+ texture(terrainRock, vPositionW.xz * rt + rpY).rgb * bw.y
+ texture(terrainRock, vPositionW.xy * rt + rpZ).rgb * bw.z);
float ao = rah0.g * w0 + rah1.g * w1 + rah2.g * w2 + rah3.g * w3 + rah4.g * w4;
  // AO: the packed channel is normalised to a mean of 0.5 per
  // layer when the texture was made, so dividing the blended
  // value back by 0.5 turns it into a mean-1 multiplier — every layer darkens
  // around its own occlusion variation rather than around wherever its raw
  // source map's mean happened to land.
surfaceAlbedo *= mix(vec3(1.0), blended, strength) * mix(1.0, ao / 0.5, strength) * detailAo;
  // Macro tint: the lush/dry variation over tens of metres, on grass only and
  // faded out with the rest of the detail. A multiplicative tint of
  // surfaceAlbedo, never a write to the material constant.
vec3 macroRgb = macroTint(macroNoise(vPositionW.xz), 1.0 - terrainN.y);
surfaceAlbedo *= mix(vec3(1.0), macroRgb, w0 * terrainMacroOn * (1.0 - smoothstep(terrainFade.x, terrainFade.y, dist)));
  // Horizon tint: past HORIZON the floor reads as the vegetation the clutter
  // has thinned out of, not as bare palette.
surfaceAlbedo = mix(surfaceAlbedo, terrainTuft, w0 * horizonWeight(dist));
  // Sward floor: inside the blade field's reach, ground carrying a sward reads
  // as the shaded thatch between the blades, not bare ground. Keyed on the
  // ground cover, not the grass texture weight, which is a mottle.
float swardW = terrainSward.w * smoothstep(terrainSwardBand.x, terrainSwardBand.y, vTerrainCover) * (1.0 - smoothstep(terrainSwardBand.z, terrainSwardBand.w, dist));
surfaceAlbedo = mix(surfaceAlbedo, terrainSward.rgb, swardW);
  // Roughness: the blended per-layer base,
  // modulated near the eye by the blended map over its own 0.5 neutral (so a
  // flat 0.5 placeholder or a failed decode is the identity, not a flash of
  // gloss); F0: per layer, never faded.
float rBase = terrainLayerRough.x * w0 + terrainLayerRough.y * w1 + terrainLayerRough.z * w2 + terrainLayerRough.w * w3 + terrainLayerRough2.x * w4;
float rMap = rah0.r * w0 + rah1.r * w1 + rah2.r * w2 + rah3.r * w3 + rah4.r * w4;
terrainRough = clamp(rBase * mix(1.0, rMap / 0.5, strength), 0.0, 1.0);
terrainF0 = terrainLayerF0.x * w0 + terrainLayerF0.y * w1 + terrainLayerF0.z * w2 + terrainLayerF0.w * w3 + terrainLayerF02.x * w4;
}
{
float rfi = (vPositionW.z - roadTable.x) / roadTable.y;
float rfl = clamp(floor(rfi), 0.0, roadTable.z - 2.0);
float rft = clamp(rfi - rfl, 0.0, 1.0);
float rx0 = texture(roadCenter, vec2((rfl + 0.5) / roadTable.z, 0.5)).r;
float rx1 = texture(roadCenter, vec2((rfl + 1.5) / roadTable.z, 0.5)).r;
float ru = vPositionW.x - mix(rx0, rx1, rft);
float rau = abs(ru);
float raa = fwidth(rau);
if (rau < 30.0) {
float rk = 1.0 - smoothstep(terrainFade.x, terrainFade.y, distance(vPositionW.xyz, terrainEye));
vec3 rGravelTex = mix(vec3(1.0), texture(terrainPebble, vPositionW.xz * terrainTiling.w).rgb / terrainRock2.y, rk);
vec3 rAsphaltTex = mix(vec3(1.0), texture(roadAsphalt, vec2(ru, vPositionW.z) * roadTable.w).rgb / terrainRock2.y, rk);
    // Asphalt's slice of the relief arrays:
    // the road's u axis is world X across the centreline, so it shares the
    // ground's planar frame — the same (ru, z) * roadTable.w coordinate the
    // asphalt albedo above was fetched with, on layer index 5.
vec3 rAsphaltN = texture(terrainNormals, vec3(vec2(ru, vPositionW.z) * roadTable.w, 5.0)).rgb * 2.0 - 1.0;
vec3 rAsphaltRAH = texture(terrainRAH, vec3(vec2(ru, vPositionW.z) * roadTable.w, 5.0)).rgb;
    // AO, the same mean-1 form as the ground
    // blend's own AO term in terrainTexture.ts: the packed channel is
    // normalised to mean 0.5 when the texture was made, so dividing by 0.5 turns it
    // into a multiplier centred on 1.0 rather than on asphalt's own raw mean.
rAsphaltTex *= mix(1.0, rAsphaltRAH.g / 0.5, rk);
float rVerge = 0.5 * (1.0 - smoothstep(5.5, 30.0, rau));
float rGravel = 1.0 - smoothstep(3.5, 5.5, rau);
float rE = max(0.4, raa);
float rAsphalt = 1.0 - smoothstep(3.5 - rE, 3.5 + rE, rau);
    // Normal/roughness/F0 blend toward the asphalt's own relief, faded by rk
    // the same way its albedo is, then gated by the asphalt band's coverage.
float rRelief = rAsphalt * rk;
normalW = normalize(mix(normalW, normalize(normalW + vec3(rAsphaltN.x, 0.0, rAsphaltN.y)), rRelief));
terrainRough = mix(terrainRough, clamp(terrainLayerRough2.y * mix(1.0, rAsphaltRAH.r / 0.5, rk), 0.0, 1.0), rAsphalt);
terrainF0 = mix(terrainF0, terrainLayerF02.y, rAsphalt);
float rPhase = mod(vPositionW.z, 12.0);
uint rh = uint(int(floor(vPositionW.z / 12.0))) * 2654435761u;
rh ^= rh >> 15u;
rh *= 2246822519u;
rh ^= rh >> 13u;
float rKeep = float(rh & 65535u) / 65536.0;
float rOn = (rPhase < 3.0 && rKeep < 0.65) ? 1.0 : 0.0;
float rLe = max(0.2, raa);
float rLine = rOn * 0.55 * (1.0 - smoothstep(0.15, 0.15 + rLe, rau));
vec3 rCol = mix(surfaceAlbedo, vec3(0.17, 0.14, 0.1) * vAlbedoColor.rgb, rVerge);
rCol = mix(rCol, vec3(0.3, 0.28, 0.24) * rGravelTex * vAlbedoColor.rgb, rGravel);
rCol = mix(rCol, vec3(0.14, 0.14, 0.15) * rAsphaltTex * vAlbedoColor.rgb, rAsphalt);
rCol = mix(rCol, vec3(0.42, 0.36, 0.18) * vAlbedoColor.rgb, rLine);
surfaceAlbedo = rCol;
}
}
{
vec4 fMeta = texture(featureTex, vec2(0.5 / 4.0, 0.75));
vec4 fRim = texture(featureTex, vec2(1.5 / 4.0, 0.75));
for (int fi = 0;
fi < 4;
fi++) {
if (float(fi) >= featureInfo.x) break;
vec4 f = texture(featureTex, vec2((float(fi) + 0.5) / 4.0, 0.25));
float fd = length(vPositionW.xz - f.xy);
if (f.w > 1.5 && f.w < 2.5) {
float meadow = 1.0 - smoothstep(f.z, f.z + fMeta.z, fd);
surfaceAlbedo *= mix(vec3(1.0), vec3(0.92, 1.06, 0.82), meadow * 0.5);
} else if (f.w > 2.5) {
float shore = 1.0 - smoothstep(f.z + fMeta.w, f.z + fMeta.w + 2.0, fd);
surfaceAlbedo *= mix(vec3(1.0), vec3(0.85, 0.78, 0.70), shore * 0.8);
} else if (f.w > 0.5) {
float above = smoothstep(fMeta.x - fMeta.y, fMeta.x, vPositionW.y);
float near = 1.0 - smoothstep(f.z - fRim.x, f.z, fd);
float crest = 1.0 - smoothstep(25.0, 40.0, fd);
float rock = max(above * near, crest);
float fLum = dot(surfaceAlbedo, vec3(0.299, 0.587, 0.114));
surfaceAlbedo = mix(surfaceAlbedo, vec3(fLum) * 1.1, rock * 0.85);
}
}
}
{
vec2 tb = clamp((vPositionW.xz - trailInfo.xy) * trailInfo.z, 0.0, trailInfo.w - 1.0);
vec2 tIdx = texture(trailIndex, (floor(tb) + 0.5) / trailInfo.w).xy;
float tdBest = 1.0e9;
vec2 tOff = vec2(0.0);
float tuBest = 0.0;
float ttBest = 0.0;
for (int ti = 0;
ti < 32;
ti++) {
if (float(ti) >= tIdx.y) break;
float tu = (tIdx.x + float(ti) + 0.5) / 512.0;
vec4 ts = texture(trailSegs, vec2(tu, 0.25));
vec2 te = ts.zw - ts.xy;
vec2 tp = vPositionW.xz - ts.xy;
float tl2 = dot(te, te);
float tt = tl2 > 0.0 ? clamp(dot(tp, te) / tl2, 0.0, 1.0) : 0.0;
vec2 to = tp - tt * te;
float td = length(to);
if (td < tdBest) { tdBest = td;
tOff = to;
tuBest = tu;
ttBest = tt;
}
}
float taa = fwidth(tdBest);
  // The texture2D calls below (gravel/floor albedo, normals, RAH) run inside
  // this branch, so their implicit-LOD derivatives are formally non-uniform
  // control flow. Pre-existing structure carried over from the wall removal;
  // it compiled and rendered correctly on Metal when checked in the browser.
if (tdBest < 7.0 + taa) {
float tk = 1.0 - smoothstep(terrainFade.x, terrainFade.y, distance(vPositionW.xyz, terrainEye));
vec2 tAway = tdBest > 1.0e-4 ? tOff / tdBest : vec2(0.0);
float tRise = dot(-vNormalW.xz, tAway) / max(vNormalW.y, 1.0e-3);
    // Soil fraction: the grass + forest-floor class weights the ground blend
    // already carries (TRAILPAINT is only ever defined alongside TERRAINTEX).
float tSoil = clamp(vTerrainW.x + vTerrainW.y, 0.0, 1.0);
    // Snow fraction: the ground blend's detail weight (vTerrainW2.y) is 1 on
    // bare ground and falls to 0 through the snow band, the only thing that
    // lowers it (terrainSurface.ts). Above the snow line a trail is packed
    // snow, not a strip of bright dirt (seen in a captured clip): the bed
    // blends to a slightly darker, bluer snow, keeps the snow's normal and
    // roughness, and the bare-floor bank fades out with the soil under it.
float tSnow = 1.0 - clamp(vTerrainW2.y, 0.0, 1.0);
vec4 tRow = texture(trailSegs, vec2(tuBest, 0.75));
float tU = mix(tRow.x, tRow.y, ttBest);
float tWj = mix(tRow.z, tRow.w, ttBest);
float tWear = 0.6 * trailValueNoise1(tU, 12.0) + 0.4 * trailValueNoise1(tU, 3.0);
float tWidthK = mix(0.8, 1.25, tWear) * tWj;
float tDarkK = mix(0.85, 1.1, tWear);
float tEdgeN = 0.6 * macroValueNoise(vPositionW.xz, 1.5) + 0.4 * macroValueNoise(vPositionW.xz, 0.4);
float tdN = tdBest + 0.25 * (2.0 * tEdgeN - 1.0);
vec2 tuvP = vPositionW.xz * terrainTiling.w;
vec2 tuvF = vPositionW.xz * terrainTiling.y;
vec3 tGravelTex = mix(vec3(1.0), texture(terrainPebble, tuvP).rgb / terrainRock2.y, tk);
vec3 tFloorTex = mix(vec3(1.0), texture(terrainFloor, tuvF).rgb / terrainRock2.y, tk);
    // The bed is earth: the floor texture over the pebbles, so the trail
    // wears the colour of the ground beside it with grit in it.
vec3 tBedTex = mix(tGravelTex, tFloorTex, 0.7);
vec3 tGravelN = texture(terrainNormals, vec3(tuvP, 4.0)).rgb * 2.0 - 1.0;
vec3 tGravelRAH = texture(terrainRAH, vec3(tuvP, 4.0)).rgb;
vec3 tFloorN = texture(terrainNormals, vec3(tuvF, 1.0)).rgb * 2.0 - 1.0;
vec3 tFloorRAH = texture(terrainRAH, vec3(tuvF, 1.0)).rgb;
    // The bed's relief is earth too: a brown tint over a cobble mosaic still
    // shades as cobbles if the normal, the occlusion and the roughness stay
    // the pebble texture's. The same share that mixes the colour mixes them.
vec3 tBedN = mix(tGravelN, tFloorN, 0.7);
vec3 tBedRAH = mix(tGravelRAH, tFloorRAH, 0.7);
float tdB = tdN / tWidthK - 0.3 * (mix(0.5, tGravelRAH.b, tk) - 0.5);
float tE = max(0.08, taa / tWidthK);
float tInCore = 1.0 - smoothstep(0.45, 0.45 + tE, tdB);
float tInMargin = 1.0 - smoothstep(0.75, 0.75 + tE, tdB);
float tCore = tInCore * (1.0 - tSnow);
float tTrample = (1.0 - tInMargin) * (1.0 - smoothstep(0.75, 1.35, tdB)) * tSoil * (1.0 - tSnow);
float tBank = smoothstep(0.0, 0.15, tRise) * (1.0 - smoothstep(0.75, 7.0, tdN)) * tSoil * (1.0 - tSnow) * (1.0 - tInMargin);
vec3 tBankBase = vColor.rgb;
    // The bed's core carries no litter of its own (only drifted stretches
    // carry duff), so the vertex-colour mix above never lifted the core the
    // way the litter floor beside it rose: the bed's base mixes the same
    // NEEDLE_BED colour in by the canopy density (the fourth weight,
    // forestDensity at the vertex), so the bed under the trees reads as the
    // floor continuing under it. In the open the density is zero and nothing
    // changes. The bank keeps the raw base: it is ground beside the bed, and
    // its vertex colour already carries the litter mix.
vec3 tBedBase = mix(tBankBase, vec3(0.15, 0.105, 0.06), 0.75 * clamp(vTerrainW2.w, 0.0, 1.0));
    // The bench takes TRAIL_BENCH_SHADE of the bed's base, the ground's own
    // vertex colour with that canopy lift, rather than the material's flat
    // white, so it wears the hue of the ground it runs through — brown under
    // canopy, tan in the meadow — the way packed earth does.
vec3 tBenchBase = mix(vec3(1.0), tBedBase, 0.8);
    // The trampled band: this ground, dried and stained toward the bench.
vec3 tCol = surfaceAlbedo * mix(vec3(1.0), vec3(0.9, 0.88, 0.8), tTrample);
    // The bank: bare forest floor on the uphill side, under the vertex colour.
tCol = mix(tCol, tFloorTex * mix(1.0, tFloorRAH.g / 0.5, tk) * tBankBase, tBank);
normalW = normalize(mix(normalW, normalize(normalW + vec3(tFloorN.x, 0.0, tFloorN.y)), tBank * tk));
terrainRough = mix(terrainRough, clamp(terrainLayerRough.y * mix(1.0, tFloorRAH.r / 0.5, tk), 0.0, 1.0), tBank);
terrainF0 = mix(terrainF0, terrainLayerF0.y, tBank);
    // Core and margin: the earth bed under two tints on the bench's own
    // shaded base, the core compacted and darkened by wear, the margin loose
    // and pale at about twice the core's brightness. Wet: the core darkens
    // and glosses, the margin half as much; puddles sit in the low spots of
    // the 6 m noise inside the core.
float tAo = mix(1.0, tBedRAH.g / 0.5, tk);
vec3 tCoreCol = vec3(0.3, 0.26, 0.21) * tDarkK * tBedTex * 0.24 * tAo * tBenchBase;
vec3 tMarginCol = vec3(0.4, 0.36, 0.3) * tBedTex * 0.47 * tAo * tBenchBase;
    // Neglect: leaf and needle drifts where the ground cover says litter lies
    // (the vertex's own duff weight, so a painted drift always has pieces
    // standing on it), and gravel washed out to bare dirt in patches of the
    // bed's own noise. Both are smoothsteps and neither touches the band
    // weights above: the bed's core stays traceable however much lies on it.
float tDrift = smoothstep(0.25, 0.7, clamp(vTerrainW2.z, 0.0, 1.0));
float tWash = smoothstep(0.55, 0.8, macroValueNoise(vPositionW.xz, 4.0));
tDrift *= 1.0 - tWash;
vec3 tDriftCol = tFloorTex * vec3(0.8893440413949226, 0.6225408289764459, 0.35573761655796904) * mix(1.0, tFloorRAH.g / 0.5, tk) * tBenchBase;
    // Keyed on the canopy density, not the litter weight or the forest-floor
    // weight: the litter weight is high beside a meadow trail too (drifts
    // reach every bed margin there), and the forest-floor weight is the
    // floor-to-grass mottle raised by that litter, about a half on open
    // ground. Either would lift the meadow's wash-out toward the litter
    // floor's darkness. The canopy density is zero in the open.
float tWashDark = mix(0.4, 0.75, clamp(vTerrainW2.w, 0.0, 1.0));
vec3 tWashCol = tFloorTex * tWashDark * mix(1.0, tFloorRAH.g / 0.5, tk) * tBenchBase;
tCoreCol = mix(mix(tCoreCol, tDriftCol, tDrift), tWashCol, tWash);
tMarginCol = mix(mix(tMarginCol, tDriftCol, tDrift), tWashCol, tWash);
float tPuddleLow = smoothstep(0.62, 0.75, 1.0 - macroValueNoise(vPositionW.xz, 6.0));
float tPuddle = smoothstep(0.55, 0.8, terrainWet) * tPuddleLow * tCore;
tCoreCol *= 1.0 - 0.35 * terrainWet;
tMarginCol *= 1.0 - 0.35 * 0.5 * terrainWet;
tCoreCol = mix(tCoreCol, tCoreCol * 0.5, tPuddle);
vec3 tPacked = surfaceAlbedo * vec3(0.86, 0.88, 0.94);
float tOnBench = tInMargin;
tCol = mix(tCol, mix(mix(tMarginCol, tCoreCol, tInCore), tPacked, tSnow), tOnBench);
float tGravel = tOnBench * (1.0 - tSnow);
vec3 tBenchN = normalize(normalW + vec3(tBedN.x, 0.0, tBedN.y) * mix(1.0, 0.5, tInCore) * (1.0 - tDrift) * (1.0 - tWash) + vec3(tFloorN.x, 0.0, tFloorN.y) * tDrift);
    // The lip: over the sink ramp outside the bench the normal tilts outward
    // and down by the ramp's slope, so a low sun draws the edge as a line.
    // Reads the width-scaled distance, like the bands above it, so the drawn
    // edge follows the painted bench's own wear-and-junction width; the
    // sim's sink ramp (trailSinkD) has no such width term and always steps
    // at the bare TRAIL_BED_HALF, so the two can disagree by up to about
    // 0.5 m at a scuffed, widened junction — accepted rather than chased.
float tRamp = smoothstep(0.75, 1.25, tdN / tWidthK);
float tLip = 4.0 * tRamp * (1.0 - tRamp) * (1.0 - tSnow);
vec3 tLipN = normalize(normalW - vec3(tAway.x, 0.0, tAway.y) * 0.12 * tLip);
normalW = normalize(mix(mix(tLipN, tBenchN, tGravel * tk), vec3(0.0, 1.0, 0.0), tPuddle));
float tRoughBench = clamp(terrainLayerRough2.x * mix(1.0, tBedRAH.r / 0.5, tk), 0.0, 1.0);
tRoughBench = mix(tRoughBench, clamp(terrainLayerRough.y * mix(1.0, tFloorRAH.r / 0.5, tk), 0.0, 1.0), tDrift);
tRoughBench = mix(tRoughBench, clamp(tRoughBench * 1.15, 0.0, 1.0), tWash);
tRoughBench *= 1.0 - 0.5 * terrainWet * mix(0.5, 1.0, tInCore);
terrainRough = mix(mix(terrainRough, tRoughBench, tGravel), 0.05, tPuddle);
terrainF0 = mix(terrainF0, terrainLayerF02.x, tGravel);
surfaceAlbedo = tCol;
}
}
float wetIn = wetInside(vPositionW.xz, wetCentre, wetRadius);
float wetW = wetBelow(vPositionW.y, wetLine) * wetIn;
surfaceAlbedo *= mix(1.0, WET_ALBEDO, wetW);
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
vec4(vReflectivityColor.r, vReflectivityColor.g * terrainRough, vReflectivityColor.b, vReflectivityColor.a * terrainF0)
,surfaceAlbedo
,metallicReflectanceFactors
,baseDiffuseRoughness
);
float microSurface=reflectivityOut.microSurface;
float roughness=mix(reflectivityOut.roughness, WET_ROUGHNESS, wetW);
float diffuseRoughness=reflectivityOut.diffuseRoughness;
surfaceAlbedo=reflectivityOut.surfaceAlbedo;
float NdotVUnclamped=dot(normalW,viewDirectionW);
float NdotV=absEps(NdotVUnclamped);
float alphaG=convertRoughnessToAverageSlope(roughness);
vec2 AARoughnessFactors=getAARoughnessFactors(normalW.xyz);
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
