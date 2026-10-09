#version 450
#define MATERIALPLUGIN_19
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
#define WATER
#define OCEAN
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
#define ALPHABLEND
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
#define LIGHT2
#define HEMILIGHT2
#define LIGHTCOUNT 3
#define MAXLIGHTCOUNT 7

#define SHADER_NAME vertex:pbr
layout(set = 1, binding = 26) uniform LeftOver {
        vec4 vFogInfos;
    vec3 vFogColor;
};

// Internals UBO
layout(set = 1, binding = 0) uniform Internals {
float yFactor_;
float textureOutputHeight_;
};
#define PBR_VERTEX_SHADER
#define CUSTOM_VERTEX_EXTENSION
precision highp float;
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
float waterLevel;
vec3 waterKd;
vec4 waterBed;
float waterBedTexels;
float waterTime;
vec2 waterWind;
vec2 waterWindTime;
vec2 waterScreen;
float waterHigh;
float waterOctaves;
vec2 waterNearFar;
vec2 waterSkin;
float waterRain;
vec4 oceanPhase0;
vec4 oceanPhase1;
vec4 oceanPhase2;
vec4 oceanSwell;
vec4 oceanTips;
vec4 oceanCoast;
vec4 oceanWind;
vec4 oceanWindDir;
vec4 oceanWindStats;
vec4 oceanWindPivot;
vec4 oceanCove;
vec4 oceanK[12];
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
layout(location = 1) in vec3 normal;
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
#define FRESNEL_MAXIMUM_ON_ROUGH 0.25
#define BRDF_DIFFUSE_MODEL_EON 0
#define BRDF_DIFFUSE_MODEL_BURLEY 1
#define BRDF_DIFFUSE_MODEL_LAMBERT 2
#define BRDF_DIFFUSE_MODEL_LEGACY 3
#define DIELECTRIC_SPECULAR_MODEL_GLTF 0
#define DIELECTRIC_SPECULAR_MODEL_OPENPBR 1
#define CONDUCTOR_SPECULAR_MODEL_GLTF 0
#define CONDUCTOR_SPECULAR_MODEL_OPENPBR 1
layout(location = 0)  out vec3 vPositionW;
layout(location = 1)  out vec3 vNormalW;
layout(location = 2)  out vec3 vEnvironmentIrradiance;
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
layout(location = 3)  out vec3 vFogDistance;
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
// Water plugin, vertex definitions: the ring's per-vertex bed depth (metres
// of water under the vertex, from the terrain height the ring sampled), which
// the fragment stage falls back to outside the bed height texture's square,
// and the vertex's view depth, which the high tier compares with the depth of
// the opaque pass behind it.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
layout(location = 2) in float bedDepth;
layout(location = 4)  out float vBedDepth;
layout(location = 5)  out float vWaterViewDepth;
// The sea's waves, vertex definitions, spliced after the water's own at
// CUSTOM_VERTEX_DEFINITIONS. Everything here, comments too, sits under the
// sea's define, so a lake's shader is the text it was.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The ring's stitch to the coarser ring around it (water.ts): the border
// blend, 0 to 1, and the half-edge to the coarser lattice, metres.
layout(location = 3) in float oceanMorph;
layout(location = 4) in vec2 oceanCoarse;
// The tables the swell is read from (oceanTables.ts): RGBA32F, one row a
// profile, a component or the coastline, read texel by texel and blended by
// hand. highp, since they hold metres and radians in the thousands.
layout(set = 1, binding = 7) uniform sampler oceanAtlasSampler;
                        layout(set = 1, binding = 6) uniform texture2D oceanAtlasTexture;
                        #define oceanAtlas sampler2D(oceanAtlasTexture, oceanAtlasSampler)
// The wind sea's displacement, a layer a cascade or a frame of the loop.
layout(set = 1, binding = 9) uniform sampler oceanWindDispSampler;
                        layout(set = 1, binding = 8) uniform texture2DArray oceanWindDispTexture;
                        #define oceanWindDisp sampler2DArray(oceanWindDispTexture, oceanWindDispSampler)
// The swash's table (oceanSwash.fx): RGBA32F, a texel a metre of the cove's
// shore, read at its nearest texel.
layout(set = 1, binding = 11) uniform sampler oceanSwashSampler;
                        layout(set = 1, binding = 10) uniform texture2D oceanSwashTexture;
                        #define oceanSwash sampler2D(oceanSwashTexture, oceanSwashSampler)
// The vertex's world xz before the waves move it.
layout(location = 6)  out vec2 vOceanXZ;
// The swell the vertex stage sums for the displacement, for the fragment
// stage: its normal's x and z, its height and the slope variance its drawn
// waves carry (vOceanSwellA), and its envelope vector in x and y with the
// vector's length in z (vOceanSwellB), the length interpolated on its own.
layout(location = 7)  out vec4 vOceanSwellA;
layout(location = 8)  out vec4 vOceanSwellB;
// Water plugin, the sea's surface: spliced into the definitions of both
// stages, after the ocean's declarations (ocean.vertex.fx, ocean.fragment.fx).
// The vertex stage sums the swell, displaces the rings with it and hands the
// fragment stage the swell's normal, height, drawn variance and envelope
// vector, from which the fragment stage makes the foam per pixel
// (oceanFoamFromEnvelope). The swell's sum is swellAt's in oceanWaves.ts line
// for line: the same atlas rows, the same reads between texel centres (each
// component's constants the same floats, bound as the oceanK uniforms rather
// than read from the components' row), the same blend of the bay and the cove
// (the phase by its own weight along the coast, the depth and the rest by the
// cove's), the same cap, the same scale of steepness, the same foam.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The literals mirror oceanPhysics.ts, oceanSwell.ts, oceanTables.ts,
// oceanWaves.ts, oceanSpectrum.ts, oceanWindSea.ts, water.ts and
// waterShading.ts, and lockstep tests assert they agree. Every read is at
// level 0, which the atlas's only level is: a read at a fixed level needs no
// derivatives, so it is legal in any control flow on WebGPU, in the vertex
// stage and the fragment stage alike.
const float OCEAN_G = 9.81;
const float OCEAN_TWO_PI = 6.283185307179586;
const float OCEAN_D_MIN = -1000.0;
const float OCEAN_D_STEP = 1.0;
const float OCEAN_TABLE_SAMPLES = 1040.0;
const float OCEAN_ATLAS_ROWS = 28.0;
const float OCEAN_ROW_BAY_PROFILE = 0.0;
const float OCEAN_ROW_COVE_PROFILE = 1.0;
const float OCEAN_ROW_BAY_FIRST = 2.0;
const float OCEAN_ROW_COVE_FIRST = 14.0;
const float OCEAN_ROW_COAST = 27.0;
const float OCEAN_DRY_DEPTH = 0.05;
const float WEGGEL_GAMMA_MIN = 0.78;
const float WEGGEL_GAMMA_MAX = 1.56;
const float SWELL_Q_SUM_MAX = 0.9;
const float OCEAN_BORE_RATIO = 0.42;
const float OCEAN_BREAK_FULL = 1.5;
const float OCEAN_BREAK_FOAM_LO = 1.0;
const float OCEAN_BREAK_FOAM_HI = 1.3;
const float OCEAN_FOAM_LIFE = 20.0;
const float OCEAN_ROLL_WIDTH = 0.6;
const float OCEAN_INNER_FOAM = 0.5;
const float SHELTER_SWELL = 0.3;
const float SHELTER_CHOP = 0.15;
const float SHELTER_WIDTH = 40.0;
// A drawn wave keeps all of its share while its phase turns by at most a
// quarter turn over one step of the drawing (four steps a wavelength), and
// none of it from a half turn (two steps), where it would alias.
const float OCEAN_RESOLVE_PHASE_LO = 1.5707963267948966;
const float OCEAN_RESOLVE_PHASE_HI = 3.141592653589793;
// The finest ring's spacing, and how many of a ring's cells lie between the
// eye and the ring's inner edge (a quarter of its side).
const float OCEAN_RING_BASE = 1.0;
const float OCEAN_RING_REACH = 32.0;
// One texel of the atlas, at its centre: the atlas is sampled nearest.
vec4 oceanAtlasTexel(float row, float column) {
return textureLod(oceanAtlas, vec2((column + 0.5) / OCEAN_TABLE_SAMPLES, (row + 0.5) / OCEAN_ATLAS_ROWS), 0.0);
}
// A row read at a fractional column, as atlasRead in oceanWaves.ts reads it:
// the column held to the table, linear between the two nearest texels.
vec4 oceanAtlasRead(float row, float column) {
float c = clamp(column, 0.0, OCEAN_TABLE_SAMPLES - 1.0);
float i0 = floor(c);
vec4 a = oceanAtlasTexel(row, i0);
vec4 b = oceanAtlasTexel(row, min(i0 + 1.0, OCEAN_TABLE_SAMPLES - 1.0));
return a + (b - a) * (c - i0);
}
// A row over d, the distance from the coastline (negative at sea), at d.
vec4 oceanAtlasRow(float row, float d) {
return oceanAtlasRead(row, (d - OCEAN_D_MIN) / OCEAN_D_STEP);
}
// The coastline's row at z, as coastRead has it: x the coastline's x, y its
// slope along z, z the cove's weight and w the phase weight, each the linear
// read of the row's channel. phaseDz is the phase weight's slope along z: the
// difference of the two texels the read mixes over the row's step, the
// derivative of the linear read exactly, and 0 where the column is below the
// row. Both texels are read whatever the column, the select is on values. The
// row starts at oceanCoast.x and steps oceanCoast.y metres a texel. Named
// apart from the oceanCoast uniform, which shares its scope.
vec4 oceanCoastAt(float z, out float phaseDz) {
float column = (z - oceanCoast.x) / oceanCoast.y;
float c = clamp(column, 0.0, OCEAN_TABLE_SAMPLES - 1.0);
float i0 = floor(c);
vec4 a = oceanAtlasTexel(OCEAN_ROW_COAST, i0);
vec4 b = oceanAtlasTexel(OCEAN_ROW_COAST, min(i0 + 1.0, OCEAN_TABLE_SAMPLES - 1.0));
phaseDz = column < 0.0 ? 0.0 : (b.w - a.w) / oceanCoast.y;
return a + (b - a) * (c - i0);
}
// One headland's shadow at p, as shelterAt has it: the share of the height
// kept, keep deep in the lee and 1 outside it. The lee lies downstream of the
// tip, on the ridge's side the swell's along-shore travel points to, and past
// the swell's line through the tip, fading in over SHELTER_WIDTH metres.
float oceanShelterTip(vec2 p, vec2 tip, float keep) {
vec2 u = oceanSwell.xy;
vec2 r = p - tip;
float side = u.y >= 0.0 ? 1.0 : -1.0;
float on = step(0.0, dot(u, r)) * step(0.0, r.y * side);
float lambda = -(u.x * r.y - u.y * r.x) * side;
return 1.0 - (1.0 - keep) * smoothstep(0.0, SHELTER_WIDTH, lambda) * on;
}
// Both headlands' shelter at p, keep being SHELTER_SWELL or SHELTER_CHOP.
float oceanShelter(vec2 p, float keep) {
return oceanShelterTip(p, oceanTips.xy, keep) * oceanShelterTip(p, oceanTips.zw, keep);
}
// The swell at the undisplaced point p: disp its displacement (x, height, z),
// normal its Gerstner normal, foam (foam, B, foamAge, depth), drawn the slope
// variance its drawn waves carry and env its envelope vector, the sum of the
// components' amplitudes on their phases. dpx and dpy are how far p moves over
// one step of the drawing, a ring's cells: a component fades out of what is
// drawn as its phase turns by more than a quarter turn a step, gone at a half
// turn. With both zero nothing fades and the sum is exactly
// swellAt's. The envelope, the break and the foam are the whole swell's and
// never fade. The loops run to a constant 12 and stop at the count, a uniform.
// Each component's constants are oceanK's, (k0x, k0z, q0, a0), the floats the
// atlas's components row holds, and each phase's sine and cosine are taken
// once, in the first loop, for the envelope and the drawn terms alike.
void oceanSwellSum(vec2 p, vec2 dpx, vec2 dpy, out vec3 disp, out vec3 normal, out vec4 foam, out float drawn, out vec2 env) {
float phaseDz;
vec4 coast = oceanCoastAt(p.y, phaseDz);
float d = p.x - coast.x;
float column = (d - OCEAN_D_MIN) / OCEAN_D_STEP;
  // Seaward of the table each phase runs on as the plane wave it is there.
float deep = min(d - OCEAN_D_MIN, 0.0);
vec4 bay = oceanAtlasRead(OCEAN_ROW_BAY_PROFILE, column);
vec4 cove = oceanAtlasRead(OCEAN_ROW_COVE_PROFILE, column);
float h = bay.x + (cove.x - bay.x) * coast.z;
float a = bay.y + (cove.y - bay.y) * coast.z;
float b = bay.z + (cove.z - bay.z) * coast.z;
float shelter = oceanShelter(p, SHELTER_SWELL);
float theta[12];
theta[0] = oceanPhase0.x;
theta[1] = oceanPhase0.y;
theta[2] = oceanPhase0.z;
theta[3] = oceanPhase0.w;
theta[4] = oceanPhase1.x;
theta[5] = oceanPhase1.y;
theta[6] = oceanPhase1.z;
theta[7] = oceanPhase1.w;
theta[8] = oceanPhase2.x;
theta[9] = oceanPhase2.y;
theta[10] = oceanPhase2.z;
theta[11] = oceanPhase2.w;
float phi[12];
float amp[12];
float q0[12];
vec2 kv[12];
float sn[12];
float cs[12];
env = vec2(0.0);
for (int c = 0;
c < 12;
c++) {
float fc = float(c);
if (fc >= oceanCoast.z) break;
vec4 k = oceanK[c];
vec4 rb = oceanAtlasRead(OCEAN_ROW_BAY_FIRST + fc, column);
vec4 rc = oceanAtlasRead(OCEAN_ROW_COVE_FIRST + fc, column);
    // The phase and its onshore wavenumber blend by the phase weight, the
    // amplitude factor by the cove's. The wavevector's z part carries the
    // coastline's turn and what the phase weight's change along z adds.
float dpsi = rc.x - rb.x;
float psi = rb.x + dpsi * coast.w + k.x * deep;
float kn = rb.y + (rc.y - rb.y) * coast.w;
float shoal = rb.z + (rc.z - rb.z) * coast.z;
phi[c] = psi + k.x * coast.x + k.y * p.y + theta[c];
kv[c] = vec2(kn, k.y + (k.x - kn) * coast.y + dpsi * phaseDz);
amp[c] = k.w * shoal * shelter;
q0[c] = k.z;
sn[c] = sin(phi[c]);
cs[c] = cos(phi[c]);
env += amp[c] * vec2(cs[c], sn[c]);
}
float envelope = length(env);
float unbroken = 2.0 * envelope;
float crestPhase = dot(env, env) > 0.0 ? atan(env.y, env.x) : 0.0;
  // No dry branch: over sand the depth is held at OCEAN_DRY_DEPTH, so the
  // swell there is the bore's few centimetres.
float hc = max(h, OCEAN_DRY_DEPTH);
float gamma = clamp(b - a * unbroken / (OCEAN_G * oceanSwell.z * oceanSwell.z), WEGGEL_GAMMA_MIN, WEGGEL_GAMMA_MAX);
float ratio = unbroken / (gamma * hc);
float scale = 1.0;
if (ratio > 1.0) {
float cap = gamma + (OCEAN_BORE_RATIO - gamma) * smoothstep(1.0, OCEAN_BREAK_FULL, ratio);
scale = hc * cap / max(unbroken, 1.0e-6);
}
float breaking = smoothstep(OCEAN_BREAK_FOAM_LO, OCEAN_BREAK_FOAM_HI, ratio);
float steepness = 0.0;
for (int c = 0;
c < 12;
c++) {
if (float(c) >= oceanCoast.z) break;
amp[c] *= scale;
steepness += q0[c] * length(kv[c]) * amp[c];
}
float s = min(1.0, SWELL_Q_SUM_MAX / max(steepness, 1.0e-6));
float height = 0.0;
vec2 across = vec2(0.0);
vec2 slope = vec2(0.0);
float fold = 0.0;
drawn = 0.0;
for (int c = 0;
c < 12;
c++) {
if (float(c) >= oceanCoast.z) break;
float turn = max(abs(dot(dpx, kv[c])), abs(dot(dpy, kv[c])));
    // Faded wholly from a half turn a step: A would be 0 and add nothing, so
    // the drawn terms alone are skipped. The envelope above keeps every
    // component, so the break and the foam do not depend on the step.
if (turn >= OCEAN_RESOLVE_PHASE_HI) continue;
float kmag = length(kv[c]);
float A = amp[c] * (1.0 - smoothstep(OCEAN_RESOLVE_PHASE_LO, OCEAN_RESOLVE_PHASE_HI, turn));
float Q = q0[c] * s;
height += A * cs[c];
across -= Q * A * kv[c] * sn[c] / kmag;
slope += A * kv[c] * sn[c];
fold += Q * A * kmag * cs[c];
drawn += 0.5 * (A * kmag) * (A * kmag);
}
disp = vec3(across.x, height, across.y);
normal = normalize(vec3(slope.x, 1.0 - fold, slope.y));
float foamAge = mod(-crestPhase, OCEAN_TWO_PI) / (OCEAN_TWO_PI / oceanSwell.z);
float roll = breaking * (1.0 - smoothstep(0.0, OCEAN_ROLL_WIDTH, mod(crestPhase, OCEAN_TWO_PI)));
float trailing = breaking * exp(-foamAge / OCEAN_FOAM_LIFE);
foam = vec4(max(max(roll, trailing), breaking * OCEAN_INNER_FOAM), breaking, foamAge, h);
}
// The swell's foam (foam, B, foamAge, depth) at the undisplaced point p from
// an envelope vector env and its magnitude envelope, as oceanSwellSum makes it
// once it has its envelope: the break from p's own depth, Weggel's index (the
// coastline's row and the two profile rows, six texels) and the magnitude, the
// crest's phase from env's angle, and from those the roll, the age and the
// trailing foam: the sum's own lines, so where env and envelope are the sum's
// at p the foam is the sum's. The fragment stage passes both interpolated
// between the ring's vertices, so the break and the age are a pixel's own and
// the roll's edge stays sharp, with no seam at a crest, where the age wraps.
// The magnitude is interpolated apart from the vector: the vector turns with
// the crest's phase across a cell, so its interpolation is a chord, whose
// length dips mid-cell to the cosine of half the turn, and the break would
// scallop along the ring's lattice. The magnitude's own interpolation keeps
// the break smooth, and the vector's angle still places the crest.
vec4 oceanFoamFromEnvelope(vec2 p, vec2 env, float envelope) {
float phaseDz;
vec4 coast = oceanCoastAt(p.y, phaseDz);
float d = p.x - coast.x;
float column = (d - OCEAN_D_MIN) / OCEAN_D_STEP;
vec4 bay = oceanAtlasRead(OCEAN_ROW_BAY_PROFILE, column);
vec4 cove = oceanAtlasRead(OCEAN_ROW_COVE_PROFILE, column);
float h = bay.x + (cove.x - bay.x) * coast.z;
float a = bay.y + (cove.y - bay.y) * coast.z;
float b = bay.z + (cove.z - bay.z) * coast.z;
float unbroken = 2.0 * envelope;
float crestPhase = dot(env, env) > 0.0 ? atan(env.y, env.x) : 0.0;
float hc = max(h, OCEAN_DRY_DEPTH);
float gamma = clamp(b - a * unbroken / (OCEAN_G * oceanSwell.z * oceanSwell.z), WEGGEL_GAMMA_MIN, WEGGEL_GAMMA_MAX);
float ratio = unbroken / (gamma * hc);
float breaking = smoothstep(OCEAN_BREAK_FOAM_LO, OCEAN_BREAK_FOAM_HI, ratio);
float foamAge = mod(-crestPhase, OCEAN_TWO_PI) / (OCEAN_TWO_PI / oceanSwell.z);
float roll = breaking * (1.0 - smoothstep(0.0, OCEAN_ROLL_WIDTH, mod(crestPhase, OCEAN_TWO_PI)));
float trailing = breaking * exp(-foamAge / OCEAN_FOAM_LIFE);
return vec4(max(max(roll, trailing), breaking * OCEAN_INNER_FOAM), breaking, foamAge, h);
}
// The share of the swell's interpolated normal a pixel keeps, from how far its
// undisplaced point moves over the pixel (dpx, dpy, the derivatives of the
// point across the screen): the vertex stage fades a component over two of the
// ring's cells, and where a pixel spans more than that, far out at a grazing
// eye, the ring still draws a swell the pixel cannot, which would crawl in
// bands. The fade is the vertex's own, a quarter to a half turn of the phase
// over a step, taken here at the peak period's deep-water wavenumber along the
// swell's travel (oceanSwell.xy). The deep wavenumber is the least the peak
// takes, since a wave shortens as it shoals, so this fades no more than the
// pixel needs: it under-fades the shallows, where the pixels lie near the eye
// and are fine enough to need no fade.
float oceanSwellPixelKeep(vec2 dpx, vec2 dpy) {
float kDeep = OCEAN_TWO_PI * OCEAN_TWO_PI / (OCEAN_G * oceanSwell.z * oceanSwell.z);
vec2 u = oceanSwell.xy;
return 1.0 - smoothstep(OCEAN_RESOLVE_PHASE_LO, OCEAN_RESOLVE_PHASE_HI, kDeep * max(abs(dot(dpx, u)), abs(dot(dpy, u))));
}
// The spacing of the ring that draws p, from p's distance to the eye: a ring
// of spacing s lies from 32 s to 64 s from the eye, so this is the ring's own
// spacing at its inner edge and the next ring's at its outer. It depends on
// the point alone, so two rings drawing one point displace it alike.
float oceanRingCell(vec2 p) {
vec2 r = abs(p - vEyePosition.xz);
return max(OCEAN_RING_BASE, max(r.x, r.y) / OCEAN_RING_REACH);
}
// The wind sea's fields: the medium tier's loop, LOOP_FRAMES frames of
// LOOP_N texels a side over LOOP_SIZE metres at WIND_SEA_U_REF, and the high
// tier's three cascades, FFT_N texels a side over FFT_CASCADE_ metres. Both
// are made with the wind along +x and turned to the wind here.
const float LOOP_N = 128.0;
const float LOOP_SIZE = 60.0;
const float LOOP_FRAMES = 64.0;
const float LOOP_SECONDS = 20.0;
const float FFT_N = 256.0;
const float FFT_CASCADE_0 = 1000.0;
const float FFT_CASCADE_1 = 150.0;
const float FFT_CASCADE_2 = 25.0;
// The loop's least scale, the wind's floor's: (0.5 / 10) squared.
const float OCEAN_LOOP_SCALE_MIN = 0.0025;
// A ring displaces a field while its cells are at most a sixteenth of the
// field's tile, and none of it from an eighth.
const float OCEAN_WIND_TILE_CELLS = 16.0;
// The wind sea off the land: over a fetch X metres of water the fetch law
// gives Hs = 0.0016 sqrt(g X / U^2) U^2 / g, which over the fully developed
// height is OCEAN_FETCH_RATIO sqrt(g X) / U, the wind's speed U held to at
// least WIND_SEA_U_FLOOR.
const float OCEAN_FETCH_RATIO = 0.005714285714285714;
const float WIND_SEA_U_FLOOR = 0.5;
// The share of the wind sea's fully developed height (oceanWind.x) at p, as
// windSeaShare in oceanWindSea.ts has it: under a wind off the land the fetch
// law's share for the water the wind has crossed since the coastline, none at
// the waterline and more with the distance out, mixed toward the whole sea by
// how onshore the wind blows (the onshore weight, oceanWindDir.w).
float oceanWindAmp(vec2 p) {
float phaseDz;
float fetch = max(oceanCoastAt(p.y, phaseDz).x - p.x, 0.0);
float share = min(1.0, OCEAN_FETCH_RATIO * sqrt(OCEAN_G * fetch) / max(oceanWindDir.z, WIND_SEA_U_FLOOR));
return share + (1.0 - share) * oceanWindDir.w;
}
// p in the wind's frame: x down the wind, z across it, about the pivot
// (oceanWindPivot.xy, the cove's waterline centre). As the wind turns, the
// fields turn about that point, where the sea is seen up close, so nothing
// slides there; a point r metres off slides at r times the wind's turn.
vec2 oceanWindFrame(vec2 p) {
vec2 d = oceanWindDir.xy;
vec2 r = p - oceanWindPivot.xy;
return vec2(dot(r, d), d.x * r.y - d.y * r.x);
}
// A vector of the wind's frame turned back into the world's.
vec2 oceanFromWind(vec2 v) {
vec2 d = oceanWindDir.xy;
return vec2(v.x * d.x - v.y * d.y, v.x * d.y + v.y * d.x);
}
// The loop's tile in metres at this wind: LOOP_SIZE times the loop's scale.
float oceanLoopSize() {
return LOOP_SIZE * max(oceanWind.y, OCEAN_LOOP_SCALE_MIN);
}
// The loop's (height, dx, dz) at uv as baked, between the two frames about
// the loop's time (oceanWind.z, already run at the wind's rate and folded).
vec3 oceanLoopRead(vec2 uv) {
float f = oceanWind.z / LOOP_SECONDS * LOOP_FRAMES;
float f0 = floor(f);
vec3 a = textureLod(oceanWindDisp, vec3(uv, f0), 0.0).xyz;
vec3 b = textureLod(oceanWindDisp, vec3(uv, mod(f0 + 1.0, LOOP_FRAMES)), 0.0).xyz;
return a + (b - a) * (f - f0);
}
// The share of a field size metres across that a ring of cell metres displaces.
float oceanWindRingKeep(float size, float cell) {
return 1.0 - smoothstep(1.0, 2.0, OCEAN_WIND_TILE_CELLS * cell / size);
}
// The wind sea's displacement (x, height, z) at p as its field draws it,
// each field faded on a ring too coarse for it (a cell of 0 fades nothing):
// the high tier's three cascades summed, the medium tier's loop scaled to the
// wind, nothing on the low tier. Not yet cut by the shore. The tier is a
// uniform (oceanCoast.w), and every read is at level 0.
vec3 oceanWindDisplaceAt(vec2 p, float cell) {
vec2 w = oceanWindFrame(p);
vec3 t = vec3(0.0);
if (oceanCoast.w > 1.5) {
t = textureLod(oceanWindDisp, vec3(w / FFT_CASCADE_0, 0.0), 0.0).xyz * oceanWindRingKeep(FFT_CASCADE_0, cell)
+ textureLod(oceanWindDisp, vec3(w / FFT_CASCADE_1, 1.0), 0.0).xyz * oceanWindRingKeep(FFT_CASCADE_1, cell)
+ textureLod(oceanWindDisp, vec3(w / FFT_CASCADE_2, 2.0), 0.0).xyz * oceanWindRingKeep(FFT_CASCADE_2, cell);
} else if (oceanCoast.w > 0.5) {
float size = oceanLoopSize();
t = oceanLoopRead(w / size) * (size / LOOP_SIZE) * oceanWindRingKeep(size, cell);
}
vec2 across = oceanFromWind(t.yz);
return vec3(across.x, t.x, across.y);
}
// The wind sea's displacement at p, nothing faded.
vec3 oceanWindDisplace(vec2 p) {
return oceanWindDisplaceAt(p, 0.0);
}
// The sea's displacement of a ring's vertex at p: a swell component under four
// of the ring's cells a wavelength, or a wind sea field a ring too coarse
// for, is faded out, so no ring aliases it. The wind sea is its share here,
// the fetch's off the land, and dies shoreward of the break, where the broken
// waves eat it, and in a headland's lee. The swell's sum is handed on for the
// fragment stage: swell its normal's x and z, its height and the slope
// variance its drawn waves carry, and env its envelope vector.
vec3 oceanDisplace(vec2 p, out vec4 swell, out vec2 env) {
float cell = oceanRingCell(p);
vec3 disp;
vec3 normal;
vec4 foam;
float drawn;
oceanSwellSum(p, vec2(2.0 * cell, 0.0), vec2(0.0, 2.0 * cell), disp, normal, foam, drawn, env);
swell = vec4(normal.x, normal.z, disp.y, drawn);
float chop = oceanWindAmp(p) * (1.0 - foam.y) * oceanShelter(p, SHELTER_CHOP);
return disp + oceanWindDisplaceAt(p, cell) * chop;
}
// Water plugin, the sea's swash: spliced into the definitions of both stages
// after the sea's surface (oceanSurface.fx), whose coastline and profile reads
// it takes. Each bore that reaches the cove's face runs up it as a thin sheet
// (swashTable.ts), one column a metre of shore, held in the oceanSwash table:
// a row of SWASH_COLUMNS texels, (front, thickness, wet reach, age) each, the
// front and the reach in metres up the face from the still waterline. The
// vertex stage lifts the sea onto the sheet and the fragment stage's depth
// takes the same lift, so the surface climbs the pebbles as a film.
//
// COMMENT RULES: never put a semicolon inside a trailing comment on a code
// line, and never spell a hashed preprocessor keyword in comment prose. The
// shaderHygiene test enforces both.
//
// The literals mirror swashTable.ts and a lockstep test asserts they agree.
// The table is read at level 0, so the read is legal in any control flow.
const float SWASH_COLUMNS = 512.0;
const float SWASH_HALF = 256.0;
const float SWASH_SHEET_MIN = 0.001;
// The depth (m) under which the fragment stage takes the sea as resting on
// the ground, a hundredth of a millimetre: the rest cancels the surface's
// height to within rounding, whatever order the sum is taken in.
const float OCEAN_REST_EPS = 0.00001;
// The texel u of the column nearest world z: the cove's centre (oceanCove.x)
// is column SWASH_HALF, a column a metre, held to the table.
float swashU(float z) {
return (clamp(z - oceanCove.x + SWASH_HALF, 0.0, SWASH_COLUMNS - 1.0) + 0.5) / SWASH_COLUMNS;
}
// The sheet's thickness (m) at d, metres up the face from the still waterline
// (negative seaward), and world z: the column's thickness at the waterline,
// thinning to nothing at its front, held to it seaward, and none past the
// front or seaward of the face's toe (oceanCove.z).
float swashSheet(float d, float z) {
vec4 col = textureLod(oceanSwash, vec2(swashU(z), 0.5), 0.0);
float cover = step(oceanCove.z, d) * step(d, col.x);
return cover * col.y * clamp(1.0 - d / max(col.x, SWASH_SHEET_MIN), 0.0, 1.0);
}
// The cove's share at world z: 1 across it, 0 past OCEAN_COVE_END beyond
// either end, blended over the ends as the wet ground's is (wet.fragment.fx).
// Here, so both stages have it: the sheet's rest below and the fragment
// stage's bed (waterLights.fragment.fx) both take it.
const float OCEAN_COVE_END = 30.0;
float oceanCoveShare(float z) {
return 1.0 - smoothstep(oceanCove.y - OCEAN_COVE_END, oceanCove.y + OCEAN_COVE_END, abs(z - oceanCove.x));
}
// How far the sheet lifts the sea at the undisplaced point p over ground h
// metres below the level (the profile's depth, negative above it), with the
// swell's height swell already on the surface: to the sheet's top where the
// sheet stands higher than the still sea, and up the face wherever the cove
// has any share, its ends' fades whole, to the ground itself wherever the
// surface would lie under it, so the sea hugs the pebbles between sheets and
// the fragment stage's depth, 0 there, discards it. Never cuts the sea.
float swashLift(vec2 p, float h, float swell) {
float phaseDz;
float sheet = swashSheet(p.x - oceanCoastAt(p.y, phaseDz).x, p.y);
float lift = max(0.0, sheet - h) * step(SWASH_SHEET_MIN, sheet);
float rest = max(0.0, -(h + swell)) * step(1.0e-6, oceanCoveShare(p.y));
return max(lift, rest);
}
// The profile's depth at p as the swell's sum blends it (its h): the bay's
// and the cove's rows by the cove's weight along the coast. For the vertex
// stage, which has no foam to read it from.
float swashDepth(vec2 p) {
float phaseDz;
vec4 coast = oceanCoastAt(p.y, phaseDz);
float column = (p.x - coast.x - OCEAN_D_MIN) / OCEAN_D_STEP;
float bay = oceanAtlasRead(OCEAN_ROW_BAY_PROFILE, column).x;
return bay + (oceanAtlasRead(OCEAN_ROW_COVE_PROFILE, column).x - bay) * coast.z;
}
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
vec3 positionUpdated=position;
vec3 normalUpdated=normal;
// The sea's rings carry world positions and no transform, so the position
// here, before the waves move it, is the world's.
// A vertex in a ring's outer band first slides toward the coarser ring's
// lattice, by the band's weight (oceanMorph) along the half-edge to it
// (oceanCoarse): at the ring's edge the weight is whole and the vertex lies
// on a vertex of the coarser ring, which evaluates the same point, so no
// border cracks. The sea is evaluated once, at that point, which is the point
// the fragment stage shades, and the swell's sum goes on to it, so it sums no
// swell of its own. The ring's normal stays up: the sea's normal is made per
// pixel, from the swell's interpolated here and the wind sea's.
positionUpdated.xz -= oceanMorph * oceanCoarse;
vOceanXZ = positionUpdated.xz;
vec4 oceanVertexSwell;
vec2 oceanVertexEnv;
vec3 oceanVertexDisplace = oceanDisplace(positionUpdated.xz, oceanVertexSwell, oceanVertexEnv);
positionUpdated += oceanVertexDisplace;
vOceanSwellA = oceanVertexSwell;
vOceanSwellB = vec4(oceanVertexEnv, length(oceanVertexEnv), 0.0);
// Up the cove's face the swash's sheet lifts the sea onto the pebbles
// (oceanSwash.fx), from where the waves were evaluated, and between sheets
// the sea rests on them, the swell's height already on it.
positionUpdated.y += swashLift(vOceanXZ, swashDepth(vOceanXZ), oceanVertexDisplace.y);
#define CUSTOM_VERTEX_UPDATE_POSITION
#define CUSTOM_VERTEX_UPDATE_NORMAL
mat4 finalWorld=world;
vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);
vPositionW=vec3(worldPos);
mat3 normalWorld=mat3(finalWorld);
vNormalW=normalize(normalWorld*normalUpdated);
vec3 viewDirectionW=normalize(vEyePosition.xyz-vPositionW);
float NdotV=max(dot(vNormalW,viewDirectionW),0.0);
vec3 roughNormal=mix(vNormalW,viewDirectionW,(0.5*(1.0-NdotV))*baseDiffuseRoughness);
vec3 reflectionVector=vec3(reflectionMatrix*vec4(roughNormal,0)).xyz;
vEnvironmentIrradiance=computeEnvironmentIrradiance(reflectionVector);
vBedDepth = bedDepth;
// Babylon's view space is left-handed: +z runs forward, so this is positive.
vWaterViewDepth = (view * worldPos).z;
#define CUSTOM_VERTEX_UPDATE_WORLDPOS
gl_Position=viewProjection*worldPos;
vec2 uvUpdated=vec2(0.,0.);
vec2 uv2Updated=vec2(0.,0.);
vFogDistance=(view*worldPos).xyz;
#define CUSTOM_VERTEX_MAIN_END
gl_Position.y *= yFactor_;
}