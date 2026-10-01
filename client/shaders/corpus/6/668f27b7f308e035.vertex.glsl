#version 450
#define MATERIALPLUGIN_20
#define DETAILDIRECTUV 0
#define DETAIL_NORMALBLENDMETHOD 0
#define RAIN
#define RAIN_OCCLUSION
#define MAINUV1
#define UV1
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
#define DIFFUSE
#define DIFFUSEDIRECTUV 1
#define AMBIENTDIRECTUV 0
#define OPACITYDIRECTUV 0
#define EMISSIVEDIRECTUV 0
#define SPECULARDIRECTUV 0
#define BUMPDIRECTUV 0
#define ALPHAFROMDIFFUSE
#define FOG
#define NUM_BONE_INFLUENCERS 0
#define BonesPerMesh 0
#define INSTANCES
#define THIN_INSTANCES
#define LIGHTMAPDIRECTUV 0
#define NUM_MORPH_INFLUENCERS 0
#define ALPHATEST_AFTERALLALPHACOMPUTATIONS
#define ALPHABLEND
#define ORDER_INDEPENDENT_TRANSPARENCY_16BITS
#define CAMERA_PERSPECTIVE
#define AREALIGHTSUPPORTED
#define VERTEX_PULLING_USE_INDEX_BUFFER
#define CLUSTLIGHT_SLICES 0
#define CLUSTLIGHT_BATCH 0
#define TEXTURE_REPETITION_MODE 0

#define SHADER_NAME vertex:default
layout(set = 1, binding = 7) uniform LeftOver {
        vec4 vFogInfos;
    vec3 vFogColor;
};

precision highp float;
// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};
#define CUSTOM_VERTEX_EXTENSION
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
vec3 rainBoxMin;
vec3 rainBoxSize;
vec2 rainDrift;
float rainFold;
float rainDt;
vec2 rainWind;
vec3 rainCam;
vec3 rainLampPos;
vec3 rainLampDir;
vec2 rainLamp;
vec4 rainSpeeds;
vec4 rainWidths;
vec4 rainAlphas;
vec2 rainMapCentre;
float rainMapExtent;
float rainCanopyWater;
vec3 rainLampColour;
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
#define CUSTOM_VERTEX_BEGIN
layout(location = 0) in vec3 position;
layout(location = 1) in vec2 uv;
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
layout(location = 2) in vec4 world0;
layout(location = 3) in vec4 world1;
layout(location = 4) in vec4 world2;
layout(location = 5) in vec4 world3;
layout(location = 0)  out vec2 vMainUV1;
layout(location = 1)  out vec3 vPositionW;
layout(location = 2)  out vec3 vFogDistance;
layout(location = 6) in vec4 rainSeed;
layout(location = 3)  out float vRainAlpha;
layout(location = 4)  out float vRainLamp;
layout(set = 1, binding = 4) uniform sampler rainMapSamplerSampler;
                        layout(set = 1, binding = 3) uniform texture2D rainMapSamplerTexture;
                        #define rainMapSampler sampler2D(rainMapSamplerTexture, rainMapSamplerSampler)
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
vec3 positionUpdated=position;
vec2 uvUpdated=uv;
{
float rkI = floor(rainSeed.w * 3.0 + 0.5);
vec4 rkSel = vec4(equal(vec4(rkI), vec4(0.0, 1.0, 2.0, 3.0)));
float rSpeed = dot(rainSpeeds, rkSel);
float rWidth = dot(rainWidths, rkSel);
float rClassAlpha = dot(rainAlphas, rkSel);
vec3 rDrift = vec3(rainDrift.x, -rSpeed * rainFold / rainBoxSize.y, rainDrift.y);
vec3 rq = fract(rainSeed.xyz + rDrift - rainBoxMin / rainBoxSize);
vec3 rp = rainBoxMin + rq * rainBoxSize;
vec3 rAlong = normalize(vec3(rainWind.x, -rSpeed, rainWind.y));
vec3 rToCam = rainCam - rp;
float rDist = max(length(rToCam), 0.001);
vec3 rView = rToCam / rDist;
vec3 rSide = cross(rAlong, rView);
vec3 rRight = rSide / max(length(rSide), 0.001);
float rLen = clamp(rSpeed * rainDt * 1.5, 0.08, 0.5);
positionUpdated = rp + rRight * (position.x * rWidth) + rAlong * (position.y * rLen);
float rFade = smoothstep(0.6, 1.5, rDist) * (1.0 - smoothstep(9.0, 12.0, rDist));
float rSky = 1.0 - 0.6 * smoothstep(0.0, 0.25, -rView.y);
vec3 rToLamp = rp - rainLampPos;
float rLampD2 = dot(rToLamp, rToLamp);
float rCos = dot(rToLamp, rainLampDir) / sqrt(max(rLampD2, 0.0001));
float rCone = smoothstep(rainLamp.y, 0.5 + 0.5 * rainLamp.y, rCos);
float rLampT = rainLamp.x * rCone / (1.0 + rLampD2);
float rCover = 1.0;
vec2 rMu = (rp.xz - rainMapCentre) / rainMapExtent + 0.5;
vec4 rMap = texture(rainMapSampler, rMu);
float rInMap = step(0.0, rMu.x) * step(rMu.x, 1.0) * step(0.0, rMu.y) * step(rMu.y, 1.0);
float rCovered = rInMap * step(rp.y, rMap.r + rMap.b);
rCover = mix(1.0, rMap.g, rCovered);
vRainAlpha = min(rFade * rCover * (rSky * rClassAlpha + rLampT), 1.0);
vRainLamp = min(rLampT, 1.0);
}
#define CUSTOM_VERTEX_UPDATE_POSITION
#define CUSTOM_VERTEX_UPDATE_NORMAL
mat4 finalWorld=mat4(world0,world1,world2,world3);
finalWorld=world*finalWorld;
vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);
#define CUSTOM_VERTEX_UPDATE_WORLDPOS
gl_Position=viewProjection*worldPos;
vPositionW=vec3(worldPos);
vec2 uv2Updated=vec2(0.,0.);
vMainUV1=uvUpdated;
vFogDistance=(view*worldPos).xyz;
#define CUSTOM_VERTEX_MAIN_END
gl_Position.y *= yFactor_;
}